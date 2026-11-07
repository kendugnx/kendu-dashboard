import crypto from 'node:crypto'
import postgres from 'postgres'
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  parseAbi,
  parseTransaction,
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
const HEALTH_MS = positiveInteger(process.env.SENDU_HEALTH_CHECK_MS, 30_000)
const MIN_GAS_WEI = BigInt(process.env.SENDU_MIN_GAS_WEI || '200000000000000')
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''
const PRICE_URL = process.env.SENDU_PRICE_URL || 'https://api.dexscreener.com/latest/dex/pairs/ethereum/0xd9f2a7471d1998c69de5cae6df5d3f070f01df9f'
const TOKEN_SCALE = 10n ** 18n
const USER_TOKEN_CAP_RAW = parseWholeTokens(process.env.SENDU_USER_TOKEN_CAP || '10m') * TOKEN_SCALE
const USER_USD_CAP_SCALED = usdScaled(process.env.SENDU_USER_USD_CAP || '500')
const GLOBAL_USD_CAP_SCALED = usdScaled(process.env.SENDU_GLOBAL_USD_CAP || '5000')
const ERC20_ABI = parseAbi([
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
])

if (!DATABASE_URL) throw new Error('TIPPING_DATABASE_URL is required')
if (!/^0x[0-9a-f]{64}$/i.test(PRIVATE_KEY)) throw new Error('SENDU_COMMUNITY_WALLET_PRIVATE_KEY must be a 32-byte hex private key')

const account = privateKeyToAccount(PRIVATE_KEY)
if (account.address !== COMMUNITY_ADDRESS) {
  throw new Error(`Signing key controls ${account.address}, not configured community wallet ${COMMUNITY_ADDRESS}`)
}

const sql = postgres(DATABASE_URL, { max: 1, idle_timeout: 20, connect_timeout: 10 })
const publicClient = createPublicClient({ chain: base, transport: http(RPC_URL) })
const walletClient = createWalletClient({ account, chain: base, transport: http(RPC_URL) })
let lastHealthCheck = 0

console.log(`[sendu] withdrawal worker ready for ${COMMUNITY_ADDRESS}`)
await ensureSystemStatusTable()
await refreshSystemStatus()
await auditConfirmedWithdrawals()
await sql`
  update sendu_withdrawals
  set status = 'pending', updated_at = now(), error = 'Recovered after worker restart'
  where status = 'processing' and updated_at < now() - interval '2 minutes'
`

while (true) {
  try {
    if (Date.now() - lastHealthCheck >= HEALTH_MS) await refreshSystemStatus()
    const worked = await processExistingTransaction() || await processPendingWithdrawal()
    if (!worked) await sleep(POLL_MS)
  } catch (error) {
    console.error(`[sendu] worker loop: ${error.message}`)
    await sleep(POLL_MS)
  }
}

async function ensureSystemStatusTable() {
  await sql`
    create table if not exists sendu_system_status (
      id boolean primary key default true check (id),
      worker_seen_at timestamptz,
      checked_at timestamptz,
      price_usd numeric(30, 18),
      wallet_balance_raw numeric(78, 0),
      liabilities_raw numeric(78, 0),
      gas_wei numeric(78, 0),
      healthy boolean not null default false,
      error text,
      updated_at timestamptz not null default now()
    )
  `
  await sql`insert into sendu_system_status (id) values (true) on conflict do nothing`
  await sql`alter table sendu_withdrawals add column if not exists automatic boolean not null default false`
  await sql`alter table sendu_withdrawals add column if not exists reason text`
}

async function refreshSystemStatus() {
  lastHealthCheck = Date.now()
  try {
    const [walletBalance, gasBalance, priceResponse, [liabilities]] = await Promise.all([
      publicClient.readContract({ address: KENDU_ADDRESS, abi: ERC20_ABI, functionName: 'balanceOf', args: [COMMUNITY_ADDRESS] }),
      publicClient.getBalance({ address: COMMUNITY_ADDRESS }),
      fetch(PRICE_URL, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) }),
      sql`
        select (
          coalesce((select sum(balance_raw) from sendu_live_accounts), 0) +
          coalesce((select sum(amount_raw) from sendu_live_tips where status = 'pending' and expires_at > now()), 0) +
          coalesce((select sum(amount_raw) from sendu_withdrawals where status in ('pending', 'processing', 'broadcasting', 'sent')), 0)
        )::numeric as amount_raw
      `,
    ])
    if (!priceResponse.ok) throw new Error(`Kendu price source returned ${priceResponse.status}`)
    const priceJson = await priceResponse.json()
    const priceUsd = Number(priceJson?.pair?.priceUsd)
    if (!Number.isFinite(priceUsd) || priceUsd <= 0) throw new Error('Kendu price source returned an invalid price')
    const liabilitiesRaw = BigInt(liabilities?.amount_raw || 0)
    const reconciled = walletBalance >= liabilitiesRaw
    const gasOk = gasBalance >= MIN_GAS_WEI
    const healthy = reconciled && gasOk
    const error = !reconciled ? 'Community wallet balance is below ledger liabilities' : !gasOk ? 'Community wallet gas is below the configured minimum' : null
    await sql`
      update sendu_system_status set
        worker_seen_at = now(), checked_at = now(), price_usd = ${priceUsd},
        wallet_balance_raw = ${walletBalance.toString()}::numeric,
        liabilities_raw = ${liabilitiesRaw.toString()}::numeric,
        gas_wei = ${gasBalance.toString()}::numeric,
        healthy = ${healthy}, error = ${error}, updated_at = now()
      where id = true
    `
    if (healthy) await queueSafetyPayouts(priceUsd, walletBalance)
  } catch (error) {
    await sql`
      update sendu_system_status set worker_seen_at = now(), checked_at = now(), healthy = false,
        error = ${String(error.message || error).slice(0, 500)}, updated_at = now()
      where id = true
    `.catch(dbError => console.error(`[sendu] health status: ${dbError.message}`))
    console.error(`[sendu] health check: ${error.message}`)
  }
}

async function queueSafetyPayouts(priceUsd, walletBalanceRaw) {
  const priceScaled = usdScaled(String(priceUsd))
  const usdUserCapRaw = (USER_USD_CAP_SCALED * TOKEN_SCALE) / priceScaled
  const userCapRaw = usdUserCapRaw < USER_TOKEN_CAP_RAW ? usdUserCapRaw : USER_TOKEN_CAP_RAW
  const globalCapRaw = (GLOBAL_USD_CAP_SCALED * TOKEN_SCALE) / priceScaled
  let globalExcessRaw = walletBalanceRaw > globalCapRaw ? walletBalanceRaw - globalCapRaw : 0n
  const candidates = await sql`
    select a.telegram_id, a.balance_raw, w.address
    from sendu_live_accounts a
    join sendu_wallets w on w.telegram_id = a.telegram_id
    where a.balance_raw > 0
      and not exists (
        select 1 from sendu_withdrawals recent
        where recent.telegram_id = a.telegram_id and recent.automatic = true
          and recent.status = 'failed' and recent.updated_at > now() - interval '1 hour'
      )
    order by a.balance_raw desc
  `
  for (const candidate of candidates) {
    const candidateBalance = BigInt(candidate.balance_raw)
    if (candidateBalance < userCapRaw && globalExcessRaw <= 0n) continue
    const queued = await sql.begin(async tx => {
      const [accountRow] = await tx`
        select balance_raw from sendu_live_accounts
        where telegram_id = ${candidate.telegram_id}
        for update
      `
      const amountRaw = BigInt(accountRow?.balance_raw || 0)
      if (amountRaw <= 0n) return 0n
      const id = crypto.randomUUID()
      const reason = amountRaw >= userCapRaw ? 'user_cap' : 'global_cap'
      await tx`update sendu_live_accounts set balance_raw = 0, updated_at = now() where telegram_id = ${candidate.telegram_id}`
      await tx`
        insert into sendu_withdrawals (id, telegram_id, to_address, amount_raw, status, automatic, reason)
        values (${id}, ${candidate.telegram_id}, ${candidate.address}, ${amountRaw.toString()}::numeric, 'pending', true, ${reason})
      `
      await tx`
        insert into sendu_live_ledger (telegram_id, amount_raw, kind, reference_id)
        values (${candidate.telegram_id}, ${(-amountRaw).toString()}::numeric, 'withdrawal_reserved', ${id})
      `
      return amountRaw
    })
    if (queued > 0n) {
      await notify(candidate.telegram_id, `<b>Sendu safety payout queued</b>\n${formatRaw(queued)} Kendu is being sent to your linked wallet because a Sendu custody limit was reached.`)
    }
    if (globalExcessRaw > 0n) globalExcessRaw = queued >= globalExcessRaw ? 0n : globalExcessRaw - queued
  }
}

async function processExistingTransaction() {
  const [withdrawal] = await sql`
    select id, telegram_id, to_address, amount_raw, status, raw_transaction, tx_hash
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
  if (!hasExpectedTransfer(receipt, withdrawal)) {
    await refundWithdrawal(withdrawal.id, 'Transaction confirmed without the expected Kendu transfer')
    await notify(withdrawal.telegram_id, `<b>Sendu withdrawal failed</b>\nNo Kendu left the community wallet. Your ${formatRaw(withdrawal.amount_raw)} Kendu was returned to your Sendu balance.`)
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
    await publicClient.simulateContract({
      account,
      address: KENDU_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [getAddress(withdrawal.to_address), BigInt(withdrawal.amount_raw)],
    })
    const data = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [getAddress(withdrawal.to_address), BigInt(withdrawal.amount_raw)],
    })
    const prepared = await walletClient.prepareTransactionRequest({
      account,
      to: KENDU_ADDRESS,
      data,
      value: 0n,
    })
    const serialized = await walletClient.signTransaction(prepared)
    const signed = parseTransaction(serialized)
    if (signed.to?.toLowerCase() !== KENDU_ADDRESS.toLowerCase() || signed.data !== data) {
      throw new Error('Refusing to broadcast malformed Kendu transfer')
    }
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

async function auditConfirmedWithdrawals() {
  const withdrawals = await sql`
    select id, telegram_id, to_address, amount_raw, tx_hash
    from sendu_withdrawals
    where status = 'confirmed' and tx_hash is not null
    order by confirmed_at desc
    limit 100
  `
  for (const withdrawal of withdrawals) {
    try {
      const receipt = await publicClient.getTransactionReceipt({ hash: withdrawal.tx_hash })
      if (receipt.status === 'success' && !hasExpectedTransfer(receipt, withdrawal)) {
        const refunded = await refundConfirmedInvalidWithdrawal(withdrawal.id, 'Confirmed transaction did not transfer Kendu')
        if (refunded) {
          console.error(`[sendu] refunded invalid confirmed withdrawal ${withdrawal.id}`)
          await notify(withdrawal.telegram_id, `<b>Sendu withdrawal corrected</b>\nNo Kendu left the community wallet. Your ${formatRaw(withdrawal.amount_raw)} Kendu was returned to your Sendu balance.`)
        }
      }
    } catch (error) {
      console.error(`[sendu] audit ${withdrawal.id}: ${error.message}`)
    }
  }
}

function hasExpectedTransfer(receipt, withdrawal) {
  return receipt.logs.some(log => {
    if (log.address.toLowerCase() !== KENDU_ADDRESS.toLowerCase()) return false
    try {
      const decoded = decodeEventLog({ abi: ERC20_ABI, data: log.data, topics: log.topics })
      return decoded.eventName === 'Transfer'
        && decoded.args.from.toLowerCase() === COMMUNITY_ADDRESS.toLowerCase()
        && decoded.args.to.toLowerCase() === getAddress(withdrawal.to_address).toLowerCase()
        && decoded.args.value === BigInt(withdrawal.amount_raw)
    } catch {
      return false
    }
  })
}

async function refundConfirmedInvalidWithdrawal(id, reason) {
  return sql.begin(async tx => {
    const [row] = await tx`
      select id, telegram_id, amount_raw, status
      from sendu_withdrawals
      where id = ${id}
      for update
    `
    if (!row || row.status !== 'confirmed') return false
    await tx`
      update sendu_withdrawals
      set status = 'failed', error = ${String(reason).slice(0, 500)}, updated_at = now()
      where id = ${id} and status = 'confirmed'
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
    return true
  })
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

function parseWholeTokens(value) {
  const match = String(value || '').trim().replace(/,/g, '').match(/^(\d+(?:\.\d+)?)\s*([kmb]?)$/i)
  if (!match) throw new Error('Invalid Sendu token limit')
  const decimals = { '': 0, k: 3, m: 6, b: 9 }[match[2].toLowerCase()]
  const [whole, fraction = ''] = match[1].split('.')
  if (fraction.length > decimals) throw new Error('Invalid Sendu token limit')
  return BigInt(whole) * (10n ** BigInt(decimals)) + BigInt((fraction + '0'.repeat(decimals)).slice(0, decimals) || '0')
}

function usdScaled(value) {
  const decimal = Number(value)
  if (!Number.isFinite(decimal) || decimal <= 0) throw new Error('Invalid Sendu USD limit or price')
  return BigInt(Math.ceil(decimal * 1e12))
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
