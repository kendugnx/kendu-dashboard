import postgres from 'postgres'
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  keccak256,
  parseAbi,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base } from 'viem/chains'

const DATABASE_URL = process.env.TIPPING_DATABASE_URL || process.env.DATABASE_URL || ''
const RPC_URL = process.env.SENDU_BASE_RPC_URL || 'https://mainnet.base.org'
const PRIVATE_KEY = String(process.env.SENDU_COMMUNITY_WALLET_PRIVATE_KEY || '')
const COMMUNITY_ADDRESS = getAddress(process.env.SENDU_COMMUNITY_WALLET_ADDRESS || '0x4BED272122494f89ef3DF52995C2C31CF5a2ef77')
const KENDU_ADDRESS = getAddress(process.env.SENDU_KENDU_BASE_ADDRESS || '0xef73611F98DA6E57e0776317957af61B59E09Ed7')
const CONFIRMATIONS = positiveInteger(process.env.SENDU_WITHDRAWAL_CONFIRMATIONS, 5)
const POLL_MS = positiveInteger(process.env.SENDU_WORKER_POLL_MS, 10_000)
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''
const ERC20_ABI = parseAbi(['function transfer(address to, uint256 amount) returns (bool)'])

if (!DATABASE_URL) throw new Error('TIPPING_DATABASE_URL is required')
if (!/^0x[0-9a-f]{64}$/i.test(PRIVATE_KEY)) throw new Error('SENDU_COMMUNITY_WALLET_PRIVATE_KEY must be a 32-byte hex private key')

const account = privateKeyToAccount(PRIVATE_KEY)
if (account.address !== COMMUNITY_ADDRESS) {
  throw new Error(`Signing key controls ${account.address}, not configured community wallet ${COMMUNITY_ADDRESS}`)
}

const sql = postgres(DATABASE_URL, { max: 1, idle_timeout: 20, connect_timeout: 10 })
const publicClient = createPublicClient({ chain: base, transport: http(RPC_URL) })
const walletClient = createWalletClient({ account, chain: base, transport: http(RPC_URL) })

console.log(`[sendu] withdrawal worker ready for ${COMMUNITY_ADDRESS}`)
await sql`
  update sendu_withdrawals
  set status = 'pending', updated_at = now(), error = 'Recovered after worker restart'
  where status = 'processing' and updated_at < now() - interval '2 minutes'
`

while (true) {
  try {
    const worked = await processExistingTransaction() || await processPendingWithdrawal()
    if (!worked) await sleep(POLL_MS)
  } catch (error) {
    console.error(`[sendu] worker loop: ${error.message}`)
    await sleep(POLL_MS)
  }
}

async function processExistingTransaction() {
  const [withdrawal] = await sql`
    select id, telegram_id, amount_raw, status, raw_transaction, tx_hash
    from sendu_withdrawals
    where status in ('broadcasting', 'sent')
    order by created_at
    limit 1
  `
  if (!withdrawal) return false

  let receipt
  try {
    receipt = await publicClient.getTransactionReceipt({ hash: withdrawal.tx_hash })
  } catch {
    if (withdrawal.status === 'broadcasting' && withdrawal.raw_transaction) {
      try {
        await publicClient.sendRawTransaction({ serializedTransaction: withdrawal.raw_transaction })
        await sql`update sendu_withdrawals set status = 'sent', updated_at = now(), error = null where id = ${withdrawal.id} and status = 'broadcasting'`
      } catch (error) {
        if (!/already known|known transaction|nonce too low/i.test(error.message || '')) throw error
        await sql`update sendu_withdrawals set status = 'sent', updated_at = now(), error = null where id = ${withdrawal.id} and status = 'broadcasting'`
      }
    }
    return true
  }

  if (receipt.status !== 'success') {
    await refundWithdrawal(withdrawal.id, 'Base transaction reverted')
    await notify(withdrawal.telegram_id, `<b>Sendu withdrawal failed</b>\nYour ${formatRaw(withdrawal.amount_raw)} Kendu was returned to your Sendu balance.`)
    return true
  }

  const latest = await publicClient.getBlockNumber()
  if (latest - receipt.blockNumber + 1n < BigInt(CONFIRMATIONS)) return true

  const [confirmed] = await sql`
    update sendu_withdrawals
    set status = 'confirmed', confirmed_at = now(), updated_at = now(), error = null
    where id = ${withdrawal.id} and status in ('broadcasting', 'sent')
    returning id
  `
  if (confirmed) {
    await notify(withdrawal.telegram_id, `<b>Sendu withdrawal confirmed</b>\n${formatRaw(withdrawal.amount_raw)} Kendu\n<a href="https://basescan.org/tx/${withdrawal.tx_hash}">View transaction</a>`)
  }
  return true
}

async function processPendingWithdrawal() {
  const withdrawal = await sql.begin(async tx => {
    const [row] = await tx`
      select id, telegram_id, to_address, amount_raw
      from sendu_withdrawals
      where status = 'pending'
      order by created_at
      for update skip locked
      limit 1
    `
    if (!row) return null
    await tx`update sendu_withdrawals set status = 'processing', updated_at = now(), error = null where id = ${row.id}`
    return row
  })
  if (!withdrawal) return false

  try {
    const { request } = await publicClient.simulateContract({
      account,
      address: KENDU_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [getAddress(withdrawal.to_address), BigInt(withdrawal.amount_raw)],
    })
    const prepared = await walletClient.prepareTransactionRequest(request)
    const serialized = await walletClient.signTransaction(prepared)
    const txHash = keccak256(serialized)
    await sql`
      update sendu_withdrawals
      set status = 'broadcasting', raw_transaction = ${serialized}, tx_hash = ${txHash}, updated_at = now()
      where id = ${withdrawal.id} and status = 'processing'
    `
    try {
      await publicClient.sendRawTransaction({ serializedTransaction: serialized })
    } catch (error) {
      if (!/already known|known transaction|nonce too low/i.test(error.message || '')) throw error
    }
    await sql`update sendu_withdrawals set status = 'sent', updated_at = now() where id = ${withdrawal.id} and status = 'broadcasting'`
  } catch (error) {
    const [current] = await sql`select status from sendu_withdrawals where id = ${withdrawal.id}`
    if (current?.status === 'processing') {
      await refundWithdrawal(withdrawal.id, error.message || 'Unable to prepare withdrawal')
      await notify(withdrawal.telegram_id, `<b>Sendu withdrawal failed</b>\nYour ${formatRaw(withdrawal.amount_raw)} Kendu was returned to your Sendu balance.`)
    } else {
      await sql`update sendu_withdrawals set error = ${String(error.message || error).slice(0, 500)}, updated_at = now() where id = ${withdrawal.id}`
    }
  }
  return true
}

async function refundWithdrawal(id, reason) {
  await sql.begin(async tx => {
    const [row] = await tx`
      select id, telegram_id, amount_raw, status
      from sendu_withdrawals
      where id = ${id}
      for update
    `
    if (!row || row.status === 'failed' || row.status === 'confirmed') return
    await tx`
      update sendu_withdrawals
      set status = 'failed', error = ${String(reason).slice(0, 500)}, updated_at = now()
      where id = ${id}
    `
    await tx`
      update sendu_live_accounts
      set balance_raw = balance_raw + ${row.amount_raw}::numeric, updated_at = now()
      where telegram_id = ${row.telegram_id}
    `
    await tx`
      insert into sendu_live_ledger (telegram_id, amount_raw, kind, reference_id)
      values (${row.telegram_id}, ${row.amount_raw}::numeric, 'withdrawal_refund', ${id})
    `
  })
}

async function notify(chatId, text) {
  if (!BOT_TOKEN) return
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  }).catch(error => console.error(`[sendu] notification: ${error.message}`))
}

function formatRaw(value) {
  const raw = BigInt(String(value))
  const whole = raw / 10n ** 18n
  const fraction = String(raw % 10n ** 18n).padStart(18, '0').replace(/0+$/, '').slice(0, 6)
  return `${whole.toLocaleString('en-US')}${fraction ? `.${fraction}` : ''}`
}

function positiveInteger(value, fallback) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : fallback
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
