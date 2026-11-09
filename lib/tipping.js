import crypto from 'node:crypto'
import postgres from 'postgres'
import { createPublicClient, decodeEventLog, formatUnits, getAddress, http, isAddress, parseAbiItem, verifyMessage } from 'viem'
import { base } from 'viem/chains'

const CLAIM_DAYS = positiveInteger(process.env.TIPPING_CLAIM_DAYS, 30)
const MAX_TIP = parseWholeTokens(process.env.TIPPING_MAX_TIP || '1000000000')
const TERMS_VERSION = 6
const DIRECT_MODE = !/^custodial$/i.test(String(process.env.SENDU_MODE || 'direct'))
const TOKEN_SCALE = 10n ** 18n
const USER_TOKEN_CAP_RAW = parseWholeTokens(process.env.SENDU_USER_TOKEN_CAP || '10m') * TOKEN_SCALE
const USER_USD_CAP_MICROS = usdMicros(process.env.SENDU_USER_USD_CAP || '500')
const GLOBAL_USD_CAP_MICROS = usdMicros(process.env.SENDU_GLOBAL_USD_CAP || '5000')
const SYSTEM_STATUS_MAX_AGE_SECONDS = positiveInteger(process.env.SENDU_STATUS_MAX_AGE_SECONDS, 120)
const WALLET_LINK_MINUTES = 15
const ACTION_LINK_MINUTES = 15
const KENDU_BASE_ADDRESS = getAddress(process.env.SENDU_KENDU_BASE_ADDRESS || '0xef73611F98DA6E57e0776317957af61B59E09Ed7')
const COMMUNITY_WALLET_ADDRESS = getAddress(process.env.SENDU_COMMUNITY_WALLET_ADDRESS || '0x4BED272122494f89ef3DF52995C2C31CF5a2ef77')
const DEPOSIT_CONFIRMATIONS = positiveInteger(process.env.SENDU_DEPOSIT_CONFIRMATIONS, 5)
const MIN_WITHDRAWAL = parseWholeTokens(process.env.SENDU_MIN_WITHDRAWAL || '1')
const MAX_WITHDRAWAL = parseWholeTokens(process.env.SENDU_MAX_WITHDRAWAL || '10000000')
const TRANSFER_EVENT = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)')
const BALANCE_OF_FUNCTION = parseAbiItem('function balanceOf(address) view returns (uint256)')
const allowedChatIds = parseIdSet(process.env.TIPPING_TEST_CHAT_IDS)
const adminUserIds = parseIdSet(process.env.TIPPING_ADMIN_USER_IDS)

let sqlClient
let schemaReady
let baseClient

export function tippingEnabledForChat(chatId) {
  return tippingGloballyEnabled() &&
    allowedChatIds.has(String(chatId))
}

function tippingGloballyEnabled() {
  return /^(1|true|on|enabled)$/i.test(String(process.env.TIPPING_ENABLED || ''))
}

function depositsEnabled() {
  return /^(1|true|on|enabled)$/i.test(String(process.env.SENDU_DEPOSITS_ENABLED || ''))
}

function withdrawalsEnabled() {
  return /^(1|true|on|enabled)$/i.test(String(process.env.SENDU_WITHDRAWALS_ENABLED || ''))
}

export function isTippingCommand(rawText) {
  return /^\/(?:sendu|tipbalance|tiphistory)(?:@\w+)?(?:\s|$)/i.test(String(rawText || ''))
}

export function isTippingCallback(data) {
  return /^sendu:(?:terms:(?:accept:\d+|cancel)|wallet:unlink:(?:confirm|cancel))$/.test(String(data || ''))
}

export function isPrivateSenduCommand(rawText, message) {
  return message?.chat?.type === 'private' && /^\/sendu(?:@\w+)?(?:\s|$)/i.test(String(rawText || '').trim())
}

export async function handlePrivateSenduCommand(rawText, message) {
  if (!tippingGloballyEnabled()) return { text: 'Sendu is currently disabled.' }
  const sql = await database()
  await upsertUser(sql, message.from)
  const acceptedTerms = await hasAcceptedTerms(sql, message.from.id)
  const action = String(rawText).trim().match(/^\/sendu(?:@\w+)?\s+(\w+)/i)?.[1]?.toLowerCase()
  if (!action) return { text: usageText() }
  if (['terms', 'disclaimer', 'rules'].includes(action)) {
    return { text: termsText(), options: acceptedTerms ? {} : agreementOptions() }
  }
  if (action === 'help') return { text: usageText() }
  if (action === 'faq') return { text: faqText() }
  if (DIRECT_MODE && ['users', 'history', 'ledger', 'stats'].includes(action)) {
    if (!acceptedTerms) return { text: termsText(), options: agreementOptions() }
    if (action === 'users') return { text: await directUsersText(sql) }
    if (action === 'history') return { text: await directHistoryText(sql, message.from.id) }
    if (action === 'stats') return { text: await directStatsText(sql) }
    return { text: await directLedgerText(sql) }
  }
  if (DIRECT_MODE && ['balance', 'bal'].includes(action)) {
    if (!acceptedTerms) return { text: termsText(), options: agreementOptions() }
    const address = await linkedWallet(sql, message.from.id)
    if (!address) return { text: 'No wallet is linked yet. Send <code>/sendu link</code> in this private chat.' }
    return { text: await linkedWalletBalanceText(address) }
  }
  if (DIRECT_MODE && ['claim', 'deposit', 'withdraw'].includes(action)) {
    return { text: '<b>Kendu Sendu has no custodial balances, deposits, claims, or withdrawals.</b>\nKendu moves directly from the sender wallet to the recipient wallet.' }
  }
  if (DIRECT_MODE && action === 'directory') {
    if (!acceptedTerms) return { text: termsText(), options: agreementOptions() }
    const setting = String(rawText).trim().match(/^\/sendu(?:@\w+)?\s+directory\s+(on|off)\s*$/i)?.[1]?.toLowerCase()
    if (!setting) return { text: 'Use <code>/sendu directory on</code> or <code>/sendu directory off</code>.' }
    await sql`alter table sendu_wallets add column if not exists directory_visible boolean not null default true`
    await sql`alter table sendu_wallets add column if not exists directory_preference_set boolean not null default false`
    await sql`update sendu_wallets set directory_visible = ${setting === 'on'}, directory_preference_set = true, updated_at = now() where telegram_id = ${message.from.id}`
    return { text: `Sendu wallet directory visibility is now <b>${setting}</b>.` }
  }
  if (['balance', 'bal'].includes(action)) {
    if (!acceptedTerms) return { text: termsText(), options: agreementOptions() }
    return { text: await balanceText(sql, message.from.id) }
  }
  if (action === 'setup') {
    if (!acceptedTerms) return { text: `${setupText(false)}\n\n${termsText()}`, options: agreementOptions() }
    const address = await linkedWallet(sql, message.from.id)
    return { text: setupText(Boolean(address), address) }
  }
  if (action === 'wallet') {
    if (!acceptedTerms) return { text: termsText(), options: agreementOptions() }
    const address = await linkedWallet(sql, message.from.id)
    return { text: address
      ? `<b>Linked Sendu wallet</b>\n<code>${escapeHtml(address)}</code>`
      : 'No wallet is linked yet. Send <code>/sendu link</code> in this private chat.' }
  }
  if (action === 'unlink') {
    if (!acceptedTerms) return { text: termsText(), options: agreementOptions() }
    const address = await linkedWallet(sql, message.from.id)
    if (!address) return { text: 'No wallet is currently linked to your Sendu account.' }
    return {
      text: `<b>Unlink Sendu wallet?</b>\n<code>${escapeHtml(address)}</code>\n\nThis removes the wallet from future Kendu Sendu transfers. Verified transaction history remains in the public ledger.`,
      options: {
        reply_markup: {
          inline_keyboard: [[
            { text: 'Unlink Wallet', callback_data: 'sendu:wallet:unlink:confirm' },
            { text: 'Cancel', callback_data: 'sendu:wallet:unlink:cancel' },
          ]],
        },
      },
    }
  }
  if (action === 'deposit') {
    if (!acceptedTerms) return { text: termsText(), options: agreementOptions() }
    const address = await linkedWallet(sql, message.from.id)
    if (!address) return { text: 'Link your wallet before depositing. Send <code>/sendu link</code> in this private chat.' }
    if (!depositsEnabled()) return { text: `${depositInstructions()}\n\n<b>Deposit claiming is not enabled yet. Do not send funds until it is enabled.</b>` }
    const txHash = String(rawText).trim().match(/^\/sendu(?:@\w+)?\s+deposit\s+(?:claim\s+)?(0x[0-9a-f]{64})\s*$/i)?.[1]
    if (!txHash) return createSenduActionLink(sql, message.from.id, 'deposit')
    const deposit = await claimLiveDeposit(sql, message.from.id, address, txHash)
    const payout = deposit.autoWithdrawal ? `\n\n<b>Safety-cap payout queued:</b> ${formatLiveKendu(deposit.autoWithdrawal.amountRaw)} Kendu to your linked wallet.` : ''
    return { text: `<b>Deposit credited</b>\nAmount: <b>${formatLiveKendu(deposit.amountRaw)} Kendu</b>\nLive balance: <b>${formatLiveKendu(deposit.balanceRaw)} Kendu</b>${payout}\n\n<a href="https://basescan.org/tx/${deposit.txHash}">View transaction</a>` }
  }
  if (action === 'withdraw') {
    if (!acceptedTerms) return { text: termsText(), options: agreementOptions() }
    const address = await linkedWallet(sql, message.from.id)
    if (!address) return { text: 'Link your wallet before withdrawing. Send <code>/sendu link</code> in this private chat.' }
    if (/^\/sendu(?:@\w+)?\s+withdraw\s+status\s*$/i.test(String(rawText).trim())) {
      return { text: await withdrawalStatusText(sql, message.from.id) }
    }
    if (/^\/sendu(?:@\w+)?\s+withdraw\s*$/i.test(String(rawText).trim())) {
      if (!withdrawalsEnabled()) return { text: `${withdrawalInstructions(address)}\n\n<b>Withdrawals are not enabled yet.</b>` }
      return createSenduActionLink(sql, message.from.id, 'withdraw')
    }
    const amountText = String(rawText).trim().match(/^\/sendu(?:@\w+)?\s+withdraw(?:\s+([\d,.]+\s*[kmb]?))?\s*(?:kendu)?\s*$/i)?.[1]
    if (!amountText) return { text: withdrawalInstructions(address) }
    if (!withdrawalsEnabled()) return { text: `${withdrawalInstructions(address)}\n\n<b>Withdrawals are not enabled yet.</b>` }
    const amount = parseWholeTokens(amountText)
    if (!amount || amount < MIN_WITHDRAWAL) return { text: `Minimum withdrawal: <b>${formatTokens(MIN_WITHDRAWAL)} Kendu</b>.` }
    if (amount > MAX_WITHDRAWAL) return { text: `Maximum withdrawal: <b>${formatTokens(MAX_WITHDRAWAL)} Kendu</b>.` }
    const withdrawal = await requestWithdrawal(sql, {
      telegramId: message.from.id,
      address,
      amountRaw: amount * TOKEN_SCALE,
      key: commandKey(message, 'withdraw'),
    })
    if (withdrawal.duplicate) return { text: 'This withdrawal request was already processed.' }
    if (withdrawal.insufficient) return { text: `Insufficient Sendu balance.\n<b>Available:</b> ${formatLiveKendu(withdrawal.balanceRaw)} Kendu` }
    return { text: `<b>Withdrawal queued</b>\nAmount: <b>${formatLiveKendu(withdrawal.amountRaw)} Kendu</b>\nTo: <code>${escapeHtml(address)}</code>\nRequest: <code>${withdrawal.id}</code>\n\nUse <code>/sendu withdraw status</code> for updates.` }
  }
  if (action !== 'link') {
    return { text: usageText() }
  }
  if (!acceptedTerms) {
    return { text: `${termsText()}\n\n<b>You must agree before linking a wallet.</b>`, options: agreementOptions() }
  }

  const existing = await linkedWallet(sql, message.from.id)
  if (existing) {
    return { text: `<b>Sendu wallet already linked</b>\n<code>${escapeHtml(existing)}</code>\n\nUse <code>/sendu unlink</code> before linking a different wallet.` }
  }

  const linkText = String(rawText).trim()
  if (DIRECT_MODE && /^\/sendu(?:@\w+)?\s+link\s+(?:deposit|verify)(?:\s|$)/i.test(linkText)) {
    return { text: 'Micro-deposit linking is not used by Kendu Sendu. Send <code>/sendu link</code> to verify your wallet with a free signature.' }
  }
  if (/^\/sendu(?:@\w+)?\s+link\s+deposit\s*$/i.test(linkText)) {
    if (!depositsEnabled()) return { text: '<b>Micro-deposit wallet linking is temporarily unavailable.</b>' }
    return createMicroDepositLinkRequest(sql, message.from.id)
  }
  const verificationHash = linkText.match(/^\/sendu(?:@\w+)?\s+link\s+verify\s+(0x[0-9a-f]{64})\s*$/i)?.[1]
  if (verificationHash) {
    if (!depositsEnabled()) return { text: '<b>Micro-deposit wallet linking is temporarily unavailable.</b>' }
    const result = await verifyMicroDepositWalletLink(sql, message.from.id, verificationHash)
    const payout = result.autoWithdrawal ? '\n\nYour existing balance reached a safety cap, so an automatic payout was queued to this wallet.' : ''
    return { text: `<b>Sendu wallet linked</b>\n<code>${escapeHtml(result.address)}</code>\n\nYour <b>${formatLiveKendu(result.amountRaw)} Kendu</b> verification deposit was credited to your Sendu balance.${payout}` }
  }
  if (/^\/sendu(?:@\w+)?\s+link\s+verify(?:\s|$)/i.test(linkText)) {
    return { text: 'Send <code>/sendu link verify TX_HASH</code> with the complete Base transaction hash.' }
  }

  const token = crypto.randomBytes(32).toString('base64url')
  const tokenHash = hashToken(token)
  await sql.begin(async tx => {
    await tx`delete from sendu_wallet_link_requests where telegram_id = ${message.from.id} and used_at is null`
    await tx`
      insert into sendu_wallet_link_requests (token_hash, telegram_id, expires_at)
      values (${tokenHash}, ${message.from.id}, now() + (${WALLET_LINK_MINUTES} * interval '1 minute'))
    `
  })
  const baseUrl = String(process.env.SENDU_DASHBOARD_URL || 'https://kendu-dashboard.com').replace(/\/$/, '')
  const walletUrl = `${baseUrl}/sendu/link#token=${encodeURIComponent(token)}`
  return {
    text: DIRECT_MODE
      ? `<b>Link your Kendu Sendu wallet</b>\n\nOpen this link in Safari or your normal browser and sign the free ownership message. This does not approve or transfer tokens.\n\n<code>${escapeHtml(walletUrl)}</code>\n\nThe single-use link expires in ${WALLET_LINK_MINUTES} minutes.`
      : `<b>Link your Sendu wallet</b>\n\n<b>Option 1: WalletConnect</b>\nOpen the link in Safari or your normal browser and sign the free ownership message.\n\n<code>${escapeHtml(walletUrl)}</code>\n\n<b>Option 2: Micro-Deposit</b>\nSend <code>/sendu link deposit</code> to receive a unique Base Kendu amount for verification.\n\nThe WalletConnect link expires in ${WALLET_LINK_MINUTES} minutes.`,
    options: {
      reply_markup: {
        inline_keyboard: [[{ text: 'Open Wallet Link', url: walletUrl }]],
      },
    },
  }
}

export async function createWalletChallenge(token, rawAddress) {
  if (!tippingGloballyEnabled()) throw new Error('Sendu is currently disabled')
  if (!isAddress(String(rawAddress || ''))) throw new Error('Enter a valid EVM wallet address')
  const address = getAddress(rawAddress)
  const sql = await database()
  const tokenHash = hashToken(token)
  const nonce = crypto.randomBytes(16).toString('hex')
  const now = new Date()
  const expiresAt = new Date(now.getTime() + WALLET_LINK_MINUTES * 60_000)
  const domain = new URL(process.env.SENDU_DASHBOARD_URL || 'https://kendu-dashboard.com').host
  const message = [
    `${domain} wants you to link this wallet to Sendu.`,
    '',
    `Wallet: ${address}`,
    'Network: Base',
    `Nonce: ${nonce}`,
    `Issued At: ${now.toISOString()}`,
    `Expires At: ${expiresAt.toISOString()}`,
    '',
    'This signature is free and does not authorize transactions or token access.',
  ].join('\n')

  const rows = await sql`
    update sendu_wallet_link_requests
    set wallet_address = ${address.toLowerCase()}, challenge = ${message}, challenge_expires_at = ${expiresAt},
      attempt_count = attempt_count + 1
    where token_hash = ${tokenHash} and used_at is null and expires_at > now() and attempt_count < 10
    returning telegram_id
  `
  if (!rows.length) throw new Error('This wallet-link request is invalid or expired')
  return { address, message, expiresAt: expiresAt.toISOString() }
}

export async function completeWalletLink(token, rawAddress, signature) {
  if (!isAddress(String(rawAddress || ''))) throw new Error('Enter a valid EVM wallet address')
  if (!/^0x[0-9a-f]{130}$/i.test(String(signature || ''))) throw new Error('Invalid wallet signature')
  const address = getAddress(rawAddress)
  const sql = await database()
  const tokenHash = hashToken(token)
  const requests = await sql`
    select telegram_id, wallet_address, challenge
    from sendu_wallet_link_requests
    where token_hash = ${tokenHash} and used_at is null and expires_at > now()
      and challenge_expires_at > now()
    limit 1
  `
  const request = requests[0]
  if (!request?.challenge || request.wallet_address !== address.toLowerCase()) {
    throw new Error('This wallet-link request is invalid or expired')
  }

  const valid = await verifyMessage({ address, message: request.challenge, signature })
  if (!valid) throw new Error('The wallet signature could not be verified')

  return sql.begin(async tx => {
    const locked = await tx`
      select telegram_id, wallet_address, challenge
      from sendu_wallet_link_requests
      where token_hash = ${tokenHash} and used_at is null and expires_at > now()
        and challenge_expires_at > now()
      for update
    `
    if (!locked.length || locked[0].wallet_address !== address.toLowerCase() || locked[0].challenge !== request.challenge) {
      throw new Error('This wallet-link request was already used')
    }
    const current = await tx`select address from sendu_wallets where telegram_id = ${request.telegram_id} for update`
    if (current.length && current[0].address !== address.toLowerCase()) {
      throw new Error('A different wallet is already linked to this Sendu account')
    }
    const owner = await tx`select telegram_id from sendu_wallets where address = ${address.toLowerCase()} for update`
    if (owner.length && String(owner[0].telegram_id) !== String(request.telegram_id)) {
      throw new Error('This wallet is already linked to another Sendu account')
    }
    await tx`
      insert into sendu_wallets (telegram_id, address)
      values (${request.telegram_id}, ${address.toLowerCase()})
      on conflict (telegram_id) do update set address = excluded.address, updated_at = now()
    `
    await tx`update sendu_wallet_link_requests set used_at = now() where token_hash = ${tokenHash}`
    return { address }
  })
}

async function createMicroDepositLinkRequest(sql, telegramId) {
  const limits = await currentSenduLimits(sql)
  if (limits.walletBalanceRaw >= limits.globalCapRaw) {
    return { text: '<b>Micro-deposit linking is paused</b>\nThe Sendu community wallet is at its global custody ceiling. Use WalletConnect to link without transferring Kendu.' }
  }
  const fraction = crypto.randomInt(100000, 1000000)
  const amountRaw = (1000000n + BigInt(fraction)) * (10n ** 12n)
  const tokenHash = hashToken(crypto.randomBytes(32).toString('base64url'))
  await sql.begin(async tx => {
    await tx`update sendu_wallet_link_requests set used_at = now() where used_at is null and expires_at <= now()`
    await tx`delete from sendu_wallet_link_requests where telegram_id = ${telegramId} and used_at is null`
    await tx`
      insert into sendu_wallet_link_requests (token_hash, telegram_id, verification_amount_raw, expires_at)
      values (${tokenHash}, ${telegramId}, ${amountRaw.toString()}::numeric, now() + (${WALLET_LINK_MINUTES} * interval '1 minute'))
    `
  })
  return {
    text: [
      '<b>Link with a Micro-Deposit</b>',
      '',
      'From the Base wallet you want to link, send exactly:',
      `<b>${formatLiveKendu(amountRaw)} Kendu</b>`,
      '',
      'To the Sendu community wallet:',
      `<code>${COMMUNITY_WALLET_ADDRESS}</code>`,
      '',
      `Kendu contract: <code>${KENDU_BASE_ADDRESS}</code>`,
      '',
      'After the transaction confirms, send:',
      '<code>/sendu link verify TX_HASH</code>',
      '',
      `This exact amount is valid for ${WALLET_LINK_MINUTES} minutes. It will be credited to your Sendu balance after verification.`,
      '',
      '<b>Send only Base Kendu directly from the wallet you want to link.</b>',
    ].join('\n'),
  }
}

async function verifyMicroDepositWalletLink(sql, telegramId, rawTxHash) {
  const txHash = rawTxHash.toLowerCase()
  const [request] = await sql`
    select token_hash, verification_amount_raw
    from sendu_wallet_link_requests
    where telegram_id = ${telegramId} and verification_amount_raw is not null
      and used_at is null and expires_at > now()
    order by created_at desc
    limit 1
  `
  if (!request) throw new Error('No active micro-deposit link request was found. Send /sendu link deposit to create one.')
  const existingDeposit = await sql`select telegram_id from sendu_deposits where tx_hash = ${txHash}`
  if (existingDeposit.length) throw new Error('This transaction has already been used')

  baseClient ||= createPublicClient({
    chain: base,
    transport: http(process.env.SENDU_BASE_RPC_URL || 'https://mainnet.base.org'),
  })
  let receipt
  try {
    receipt = await baseClient.getTransactionReceipt({ hash: txHash })
  } catch {
    throw new Error('That Base transaction was not found or is not confirmed yet')
  }
  if (receipt.status !== 'success') throw new Error('That Base transaction did not succeed')
  const latestBlock = await baseClient.getBlockNumber()
  const confirmations = latestBlock - receipt.blockNumber + 1n
  if (confirmations < BigInt(DEPOSIT_CONFIRMATIONS)) {
    throw new Error(`That transaction has ${confirmations} of ${DEPOSIT_CONFIRMATIONS} required confirmations`)
  }

  const expectedAmount = BigInt(request.verification_amount_raw)
  const matches = []
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== KENDU_BASE_ADDRESS.toLowerCase()) continue
    try {
      const decoded = decodeEventLog({ abi: [TRANSFER_EVENT], data: log.data, topics: log.topics })
      if (getAddress(decoded.args.to) === COMMUNITY_WALLET_ADDRESS && decoded.args.value === expectedAmount) {
        matches.push(getAddress(decoded.args.from))
      }
    } catch {
      // Ignore unrelated token logs.
    }
  }
  if (matches.length !== 1) throw new Error(`That transaction does not contain the assigned ${formatLiveKendu(expectedAmount)} Kendu transfer`)
  const address = matches[0]
  if (getAddress(receipt.from) !== address) throw new Error('The transaction must be sent directly from the wallet being linked')
  const limits = await currentSenduLimits(sql)

  return sql.begin(async tx => {
    const [locked] = await tx`
      select token_hash, verification_amount_raw
      from sendu_wallet_link_requests
      where token_hash = ${request.token_hash} and telegram_id = ${telegramId}
        and used_at is null and expires_at > now()
      for update
    `
    if (!locked || BigInt(locked.verification_amount_raw) !== expectedAmount) throw new Error('This micro-deposit request is invalid or expired')
    const used = await tx`select telegram_id from sendu_deposits where tx_hash = ${txHash} for update`
    if (used.length) throw new Error('This transaction has already been used')
    const current = await tx`select address from sendu_wallets where telegram_id = ${telegramId} for update`
    if (current.length && current[0].address !== address.toLowerCase()) throw new Error('A different wallet is already linked to this Sendu account')
    const owner = await tx`select telegram_id from sendu_wallets where address = ${address.toLowerCase()} for update`
    if (owner.length && String(owner[0].telegram_id) !== String(telegramId)) throw new Error('This wallet is already linked to another Sendu account')

    await tx`
      insert into sendu_wallets (telegram_id, address)
      values (${telegramId}, ${address.toLowerCase()})
      on conflict (telegram_id) do update set address = excluded.address, updated_at = now()
    `
    await tx`
      insert into sendu_deposits (tx_hash, telegram_id, from_address, amount_raw, block_number)
      values (${txHash}, ${telegramId}, ${address.toLowerCase()}, ${expectedAmount.toString()}::numeric, ${receipt.blockNumber.toString()}::bigint)
    `
    const [creditedAccount] = await tx`
      update sendu_live_accounts
      set balance_raw = balance_raw + ${expectedAmount.toString()}::numeric, updated_at = now()
      where telegram_id = ${telegramId}
      returning balance_raw
    `
    await tx`
      insert into sendu_live_ledger (telegram_id, amount_raw, kind, reference_id)
      values (${telegramId}, ${expectedAmount.toString()}::numeric, 'deposit', ${txHash})
    `
    await tx`
      update sendu_wallet_link_requests
      set wallet_address = ${address.toLowerCase()}, verification_tx_hash = ${txHash}, used_at = now()
      where token_hash = ${request.token_hash} and used_at is null
    `
    const creditedBalanceRaw = BigInt(creditedAccount.balance_raw)
    const capReached = creditedBalanceRaw >= limits.userCapRaw
    const globalCapReached = limits.walletBalanceRaw + expectedAmount >= limits.globalCapRaw
    const autoWithdrawal = capReached || globalCapReached
      ? await queueAutomaticWithdrawalTx(tx, {
          telegramId,
          address,
          amountRaw: creditedBalanceRaw,
          reason: capReached ? 'user_cap' : 'global_cap',
        })
      : null
    return { address, amountRaw: expectedAmount, autoWithdrawal }
  })
}

export async function getSenduAction(token, requestedAction) {
  const sql = await database()
  const [request] = await sql`
    select action, wallet_address, telegram_id
    from sendu_action_requests
    where token_hash = ${hashToken(token)} and used_at is null and expires_at > now()
    limit 1
  `
  if (!request || request.action !== requestedAction) throw new Error('This Sendu link is invalid or expired')
  let depositLimit = null
  if (request.action === 'deposit') {
    const limits = await currentSenduLimits(sql)
    const [account] = await sql`select balance_raw from sendu_live_accounts where telegram_id = ${request.telegram_id}`
    const [pending] = await sql`select coalesce(sum(amount_raw), 0) as amount_raw from sendu_live_tips where recipient_id = ${request.telegram_id} and status = 'pending' and expires_at > now()`
    const exposure = BigInt(account?.balance_raw || 0) + BigInt(pending?.amount_raw || 0)
    const userRemaining = limits.userCapRaw > exposure ? limits.userCapRaw - exposure : 0n
    const globalRemaining = limits.globalCapRaw > limits.walletBalanceRaw ? limits.globalCapRaw - limits.walletBalanceRaw : 0n
    const maxRaw = userRemaining < globalRemaining ? userRemaining : globalRemaining
    if (maxRaw <= 0n) throw new Error('Sendu deposits are paused because a custody limit has been reached')
    depositLimit = { raw: maxRaw.toString(), display: formatLiveKendu(maxRaw) }
  }
  return {
    action: request.action,
    walletAddress: getAddress(request.wallet_address),
    communityAddress: COMMUNITY_WALLET_ADDRESS,
    tokenAddress: KENDU_BASE_ADDRESS,
    minWithdrawal: MIN_WITHDRAWAL.toString(),
    maxWithdrawal: MAX_WITHDRAWAL.toString(),
    depositLimit,
  }
}

export async function completeSenduDeposit(token, txHash) {
  if (!depositsEnabled()) throw new Error('Sendu deposits are disabled')
  const sql = await database()
  const tokenHash = hashToken(token)
  const [request] = await sql`
    select telegram_id, wallet_address
    from sendu_action_requests
    where token_hash = ${tokenHash} and action = 'deposit' and used_at is null and expires_at > now()
    limit 1
  `
  if (!request) throw new Error('This deposit link is invalid or expired')
  const deposit = await claimLiveDeposit(sql, request.telegram_id, request.wallet_address, txHash)
  await sql`update sendu_action_requests set used_at = now() where token_hash = ${tokenHash} and used_at is null`
  return {
    amount: formatLiveKendu(deposit.amountRaw),
    balance: formatLiveKendu(deposit.balanceRaw),
    txHash: deposit.txHash,
    autoWithdrawal: deposit.autoWithdrawal ? { id: deposit.autoWithdrawal.id, amount: formatLiveKendu(deposit.autoWithdrawal.amountRaw) } : null,
  }
}

export async function createWithdrawalChallenge(token, rawAddress, amountText) {
  if (!withdrawalsEnabled()) throw new Error('Sendu withdrawals are disabled')
  if (!isAddress(String(rawAddress || ''))) throw new Error('Connect a valid Base wallet')
  const amount = parseWholeTokens(amountText)
  if (!amount || amount < MIN_WITHDRAWAL) throw new Error(`Minimum withdrawal is ${formatTokens(MIN_WITHDRAWAL)} Kendu`)
  if (amount > MAX_WITHDRAWAL) throw new Error(`Maximum withdrawal is ${formatTokens(MAX_WITHDRAWAL)} Kendu`)
  const amountRaw = amount * TOKEN_SCALE
  const address = getAddress(rawAddress)
  const sql = await database()
  const tokenHash = hashToken(token)
  const [request] = await sql`
    select telegram_id, wallet_address
    from sendu_action_requests
    where token_hash = ${tokenHash} and action = 'withdraw' and used_at is null and expires_at > now()
    limit 1
  `
  if (!request || getAddress(request.wallet_address) !== address) throw new Error('Connect the wallet linked to this Sendu account')
  const [account] = await sql`select balance_raw from sendu_live_accounts where telegram_id = ${request.telegram_id}`
  if (BigInt(account?.balance_raw || 0) < amountRaw) throw new Error('Insufficient Sendu balance')

  const expiresAt = new Date(Date.now() + ACTION_LINK_MINUTES * 60_000)
  const domain = new URL(process.env.SENDU_DASHBOARD_URL || 'https://kendu-dashboard.com').host
  const message = [
    `${domain} Sendu withdrawal authorization`,
    '',
    `Amount: ${formatTokens(amount)} Kendu`,
    `Destination: ${address}`,
    `Request: ${tokenHash.slice(0, 16)}`,
    `Expires At: ${expiresAt.toISOString()}`,
    '',
    'This signature is free and authorizes only this Sendu withdrawal request.',
  ].join('\n')
  const rows = await sql`
    update sendu_action_requests
    set amount_raw = ${amountRaw.toString()}::numeric, challenge = ${message}, challenge_expires_at = ${expiresAt}
    where token_hash = ${tokenHash} and used_at is null and expires_at > now()
    returning telegram_id
  `
  if (!rows.length) throw new Error('This withdrawal link is invalid or expired')
  return { message, amount: formatTokens(amount), address }
}

export async function completeSenduWithdrawal(token, rawAddress, signature) {
  if (!withdrawalsEnabled()) throw new Error('Sendu withdrawals are disabled')
  if (!isAddress(String(rawAddress || '')) || !/^0x[0-9a-f]{130}$/i.test(String(signature || ''))) throw new Error('Invalid withdrawal signature')
  const address = getAddress(rawAddress)
  const sql = await database()
  const tokenHash = hashToken(token)
  const [request] = await sql`
    select telegram_id, wallet_address, amount_raw, challenge
    from sendu_action_requests
    where token_hash = ${tokenHash} and action = 'withdraw' and used_at is null and expires_at > now()
      and challenge_expires_at > now()
    limit 1
  `
  if (!request?.challenge || getAddress(request.wallet_address) !== address) throw new Error('This withdrawal link is invalid or expired')
  if (!await verifyMessage({ address, message: request.challenge, signature })) throw new Error('The withdrawal signature could not be verified')

  const withdrawal = await requestWithdrawal(sql, {
    telegramId: request.telegram_id,
    address,
    amountRaw: BigInt(request.amount_raw),
    key: `web:${tokenHash}:withdraw`,
  })
  if (withdrawal.duplicate) throw new Error('This withdrawal was already submitted')
  if (withdrawal.insufficient) throw new Error('Insufficient Sendu balance')
  await sql`update sendu_action_requests set used_at = now() where token_hash = ${tokenHash} and used_at is null`
  return { id: withdrawal.id, amount: formatLiveKendu(withdrawal.amountRaw), address }
}

export async function observeTippingUser(message) {
  if (!tippingEnabledForChat(message?.chat?.id) || !message?.from?.id) return
  const sql = await database()
  await upsertUser(sql, message.from)
}

export async function handleTippingCallback(callbackQuery) {
  if (!tippingGloballyEnabled()) return { text: 'Sendu is currently disabled.', showAlert: true }
  if (callbackQuery?.message?.chat?.type !== 'private') {
    return { text: 'For privacy, accept the Sendu terms in a private chat with the bot.', showAlert: true }
  }
  if (!callbackQuery?.from?.id) return { text: 'Unable to identify your Telegram account.', showAlert: true }

  if (callbackQuery.data === 'sendu:wallet:unlink:cancel') {
    return { text: 'Your linked wallet was not changed.', showAlert: true }
  }
  if (callbackQuery.data === 'sendu:wallet:unlink:confirm') {
    const sql = await database()
    await upsertUser(sql, callbackQuery.from)
    const removed = await sql`delete from sendu_wallets where telegram_id = ${callbackQuery.from.id} returning address`
    return { text: removed.length
      ? DIRECT_MODE
        ? 'Wallet unlinked. Your verified Kendu Sendu transaction history was not changed. Link a wallet again before sending or receiving.'
        : 'Wallet unlinked. Your allocated Sendu tip balance and ledger history were not changed. Deposits and withdrawals require a linked wallet.'
      : 'No wallet is currently linked to your Sendu account.', showAlert: true }
  }

  if (callbackQuery.data === 'sendu:terms:cancel') {
    return { text: 'No changes were made to your Sendu account.', showAlert: true }
  }

  const requestedVersion = Number(callbackQuery.data.match(/^sendu:terms:accept:(\d+)$/)?.[1])
  if (requestedVersion !== TERMS_VERSION) {
    return { text: 'These Sendu terms are outdated. Run /sendu terms to review the current version.', showAlert: true }
  }

  const sql = await database()
  await upsertUser(sql, callbackQuery.from)
  await sql`
    update sendu_users
    set terms_version = ${TERMS_VERSION}, terms_accepted_at = now(),
      activated_at = coalesce(activated_at, now()), updated_at = now()
    where telegram_id = ${callbackQuery.from.id}
  `
  if (DIRECT_MODE) {
    await sql`
      update sendu_wallets set directory_visible = true, updated_at = now()
      where telegram_id = ${callbackQuery.from.id} and directory_preference_set = false
    `
  }
  return { text: 'Sendu terms accepted. You can now use Sendu.', showAlert: true }
}

export async function handleTippingCommand({ rawText, message }) {
  if (!isTippingCommand(rawText)) return null
  if (!tippingEnabledForChat(message?.chat?.id)) {
    const setupHint = adminUserIds.has(String(message?.from?.id))
      ? `\nCurrent chat ID: <code>${message.chat.id}</code>`
      : ''
    return { text: `Sendu tipping is not enabled in this chat.${setupHint}` }
  }

  const sql = await database()
  if (DIRECT_MODE) return handleDirectTippingCommand(sql, rawText, message)
  await expirePendingTips(sql)
  await upsertUser(sql, message.from)
  if (message.reply_to_message?.from?.id) await upsertUser(sql, message.reply_to_message.from)

  const normalized = rawText
    .replace(/^\/(?:sendu|tipbalance|tiphistory)(?:@\w+)?\s*/i, '')
    .trim()
  const command = rawText.match(/^\/(sendu|tipbalance|tiphistory)/i)?.[1]?.toLowerCase()

  const ledgerMatch = normalized.match(/^ledger(?:\s+(\d+))?$/i)
  if (ledgerMatch) {
    const page = Math.max(1, Number(ledgerMatch[1] || 1))
    return { text: await ledgerText(sql, page) }
  }
  const acceptedTerms = await hasAcceptedTerms(sql, message.from.id)
  if (/^faq$/i.test(normalized)) return { text: faqText() }
  if (/^(terms|disclaimer|rules)$/i.test(normalized)) {
    return { text: privateChatInstruction('review and accept the Sendu terms', '/sendu terms') }
  }
  if (/^help$/i.test(normalized) || !normalized) return { text: usageText() }
  if (/^setup$/i.test(normalized)) {
    return { text: privateChatInstruction('set up Sendu', '/sendu setup') }
  }
  if (/^link$/i.test(normalized)) {
    return { text: privateChatInstruction('link your Sendu wallet', '/sendu link') }
  }
  if (/^unlink$/i.test(normalized)) {
    return { text: privateChatInstruction('unlink your Sendu wallet', '/sendu unlink') }
  }
  if (/^wallet$/i.test(normalized)) {
    return { text: privateChatInstruction('check your linked Sendu wallet', '/sendu wallet') }
  }
  if (/^deposit(?:\s|$)/i.test(normalized)) {
    return { text: privateChatInstruction('deposit Kendu', '/sendu deposit') }
  }
  if (/^withdraw(?:\s|$)/i.test(normalized)) {
    return { text: privateChatInstruction('withdraw Kendu', '/sendu withdraw') }
  }
  if (!acceptedTerms) return publicAgreementResponse()

  if (command === 'tipbalance' || /^(balance|bal)$/i.test(normalized)) {
    return { text: await balanceText(sql, message.from.id) }
  }
  if (command === 'tiphistory' || /^history$/i.test(normalized)) {
    return { text: await historyText(sql, message.from.id) }
  }
  if (/^claim$/i.test(normalized)) {
    const result = await claimPending(sql, message.from.id, commandKey(message, 'claim'))
    return { text: result.duplicate
      ? 'This claim command was already processed.'
      : result.capBlocked
        ? `<b>Claim paused</b>\nClaiming all pending tips would exceed your current Sendu safety cap of <b>${formatLiveKendu(result.capRaw)} Kendu</b>. Link a wallet or reduce your balance first.`
      : result.amountRaw > 0n
        ? `<b>Claimed:</b> ${formatLiveKendu(result.amountRaw)} Kendu\n<b>Balance:</b> ${formatLiveKendu(result.balanceRaw)} Kendu${result.autoWithdrawal ? `\n<b>Automatic payout:</b> ${formatLiveKendu(result.autoWithdrawal.amountRaw)} Kendu queued to your linked wallet.` : ''}`
        : `You have no pending Sendu tips.\n<b>Balance:</b> ${formatLiveKendu(result.balanceRaw)} Kendu` }
  }
  const parsed = parseSend(normalized, message)
  if (!parsed) return { text: usageText() }
  if (!parsed.amount || parsed.amount <= 0n) return { text: 'Enter a positive whole-Kendu amount.' }
  if (parsed.amount > MAX_TIP) return { text: `The maximum is ${formatTokens(MAX_TIP)} Kendu per tip.` }

  const recipient = await resolveTarget(sql, message, parsed.username)
  if (!recipient?.id) return { text: 'I do not know that user yet. Reply directly to one of their messages with <code>/sendu [amount]</code>.' }
  if (String(recipient.id) === String(message.from.id)) return { text: 'You cannot Sendu yourself.' }

  const result = await sendTip(sql, {
    senderId: message.from.id,
    recipientId: recipient.id,
    amountRaw: parsed.amount * TOKEN_SCALE,
    commandKey: commandKey(message, 'send'),
  })
  if (result.duplicate) return { text: 'This tip was already processed.' }
  if (result.insufficient) return { text: `Insufficient Sendu balance.\n<b>Available:</b> ${formatLiveKendu(result.balanceRaw)} Kendu` }
  if (result.capBlocked) return { text: `<b>Tip not sent</b>\nThis recipient has reached the current Sendu safety cap of <b>${formatLiveKendu(result.capRaw)} Kendu</b>. They must reduce their balance or link a wallet before receiving more.` }

  const lines = [
    `<b>Sendu!</b> ${displayName(message.from)} tipped ${displayName(recipient)} <b>${formatTokens(parsed.amount)} Kendu</b>.`,
    `<b>Sender balance:</b> ${formatLiveKendu(result.senderBalanceRaw)} Kendu`,
  ]
  if (result.pending) {
    lines.push('', `${displayName(recipient)} must use <code>/sendu claim</code> within ${CLAIM_DAYS} days or the tip returns to the sender.`)
  } else {
    lines.push(`<b>Recipient balance:</b> ${formatLiveKendu(result.recipientBalanceRaw)} Kendu`)
    if (result.autoWithdrawal) lines.push(`<b>Automatic payout:</b> ${formatLiveKendu(result.autoWithdrawal.amountRaw)} Kendu queued to their linked wallet.`)
  }
  return { text: lines.join('\n') }
}

async function handleDirectTippingCommand(sql, rawText, message) {
  await upsertUser(sql, message.from)
  if (message.reply_to_message?.from?.id) await upsertUser(sql, message.reply_to_message.from)
  const normalized = rawText.replace(/^\/(?:sendu|tipbalance|tiphistory)(?:@\w+)?\s*/i, '').trim()
  if (/^faq$/i.test(normalized)) return { text: faqText() }
  if (/^(terms|disclaimer|rules)$/i.test(normalized)) return { text: privateChatInstruction('review and accept the Sendu terms', '/sendu terms') }
  if (/^(setup|link|unlink|wallet|directory)(?:\s|$)/i.test(normalized)) {
    return { text: privateChatInstruction('manage your Kendu Sendu wallet', `/sendu ${normalized}`) }
  }
  if (!normalized || /^help$/i.test(normalized)) return { text: usageText() }
  if (!await hasAcceptedTerms(sql, message.from.id)) return publicAgreementResponse()
  if (/^(balance|bal|claim|deposit|withdraw)(?:\s|$)/i.test(normalized)) {
    return { text: '<b>Kendu Sendu has no custodial balances, deposits, claims, or withdrawals.</b>\nKendu moves directly between linked wallets.' }
  }
  if (/^ledger$/i.test(normalized)) return { text: await directLedgerText(sql) }
  if (/^history$/i.test(normalized)) return { text: await directHistoryText(sql, message.from.id) }
  if (/^users$/i.test(normalized)) return { text: await directUsersText(sql) }
  if (/^stats$/i.test(normalized)) return { text: await directStatsText(sql) }
  const transactionOnlyVerification = normalized.match(/^verify\s+(0x[0-9a-f]{64})$/i)
  if (transactionOnlyVerification) {
    const completed = await completedDirectSenduByTransaction(transactionOnlyVerification[1], message.from.id)
    return {
      text: directAnnouncementText(completed),
      options: { link_preview_options: { is_disabled: true } },
      markAnnouncementId: completed.id,
    }
  }
  const verification = normalized.match(/^verify\s+([0-9a-f-]{36})\s+(0x[0-9a-f]{64})$/i)
  if (verification) {
    const completed = await completeDirectSendu(verification[1], verification[2], message.from.id)
    return {
      text: directAnnouncementText(completed),
      options: { link_preview_options: { is_disabled: true } },
      markAnnouncementId: completed.id,
    }
  }

  const parsed = parseSend(normalized, message)
  if (!parsed) return { text: usageText() }
  if (!parsed.amount || parsed.amount <= 0n) {
    return { text: 'Enter a positive whole-Kendu amount. Decimals are not supported unless shorthand resolves to a whole number, such as <code>1.5m</code>.' }
  }
  if (parsed.amount > MAX_TIP) return { text: `The maximum is ${formatTokens(MAX_TIP)} Kendu per Sendu.` }
  const recipient = await resolveTarget(sql, message, parsed.username)
  if (!recipient?.id) {
    const recipientName = parsed.username ? escapeHtml(parsed.username) : 'That user'
    return { text: `${recipientName} must accept the Kendu Sendu terms and link a wallet privately first.` }
  }
  if (String(recipient.id) === String(message.from.id)) return { text: 'You cannot Sendu yourself.' }
  if (!await hasAcceptedTerms(sql, recipient.id)) return { text: `${displayName(recipient)} must accept the Kendu Sendu terms and link a wallet privately first.` }
  const senderAddress = await linkedWallet(sql, message.from.id)
  if (!senderAddress) return { text: privateChatInstruction('link your wallet before sending', '/sendu link') }
  const recipientAddress = await linkedWallet(sql, recipient.id)
  if (!recipientAddress) return { text: `${displayName(recipient)} must accept the Kendu Sendu terms and link a wallet privately first.` }

  const request = await createDirectRequest(sql, {
    senderId: message.from.id, recipientId: recipient.id, senderAddress, recipientAddress,
    amountRaw: parsed.amount * TOKEN_SCALE, chatId: message.chat.id,
  })
  const baseUrl = String(process.env.SENDU_DASHBOARD_URL || 'https://kendu-dashboard.com').replace(/\/$/, '')
  const url = `${baseUrl}/sendu/direct#token=${encodeURIComponent(request.token)}`
  return {
    privateMessage: {
      chatId: message.from.id,
      text: [
        `<b>Kendu Sendu</b> ${displayName(message.from)} → ${displayName(recipient)}`,
        `<b>${formatTokens(parsed.amount)} Kendu</b>`, '',
        'Open this in Safari or your normal browser and approve the Base transfer from your linked wallet.',
        `<code>${escapeHtml(url)}</code>`, '',
        `Manual verification: <code>/sendu verify ${request.id} TX_HASH</code>`,
        `Expires in ${ACTION_LINK_MINUTES} minutes.`,
      ].join('\n'),
      options: { reply_markup: { inline_keyboard: [[{ text: 'Send Kendu', url }]] }, link_preview_options: { is_disabled: true } },
    },
  }
}

async function createDirectRequest(sql, input) {
  const token = crypto.randomBytes(32).toString('base64url')
  const id = crypto.randomUUID()
  await sql`
    insert into sendu_direct_requests
      (id, token_hash, sender_id, recipient_id, sender_address, recipient_address, amount_raw, chat_id, expires_at)
    values (${id}, ${hashToken(token)}, ${input.senderId}, ${input.recipientId}, ${input.senderAddress.toLowerCase()},
      ${input.recipientAddress.toLowerCase()}, ${input.amountRaw.toString()}::numeric, ${input.chatId},
      now() + (${ACTION_LINK_MINUTES} * interval '1 minute'))
  `
  return { id, token }
}

export async function getDirectSendu(token) {
  const sql = await database()
  const [row] = await sql`
    select r.*, sender.username sender_username, sender.display_name sender_name,
      recipient.username recipient_username, recipient.display_name recipient_name
    from sendu_direct_requests r join sendu_users sender on sender.telegram_id=r.sender_id
    join sendu_users recipient on recipient.telegram_id=r.recipient_id where r.token_hash=${hashToken(token)}
  `
  if (!row || new Date(row.expires_at) <= new Date()) throw new Error('This Kendu Sendu link is invalid or expired')
  if (row.completed_at) throw new Error('This Kendu Sendu was already completed')
  return {
    id: row.id, senderAddress: getAddress(row.sender_address), recipientAddress: getAddress(row.recipient_address),
    amountRaw: String(row.amount_raw), amount: formatLiveKendu(row.amount_raw), tokenAddress: KENDU_BASE_ADDRESS,
    sender: formatStoredUser(row.sender_name, row.sender_username), recipient: formatStoredUser(row.recipient_name, row.recipient_username),
  }
}

export async function completeDirectSendu(tokenOrId, rawTxHash, telegramId = null) {
  if (!/^0x[0-9a-f]{64}$/i.test(String(rawTxHash || ''))) throw new Error('Enter a valid Base transaction hash')
  const sql = await database()
  const byId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(tokenOrId || ''))
  const rows = byId
    ? await sql`select * from sendu_direct_requests where id=${tokenOrId}`
    : await sql`select * from sendu_direct_requests where token_hash=${hashToken(tokenOrId)}`
  const request = rows[0]
  if (!request || new Date(request.expires_at) <= new Date()) throw new Error('This Kendu Sendu request is invalid or expired')
  if (telegramId != null && String(request.sender_id) !== String(telegramId)) throw new Error('Only the sender can verify this Kendu Sendu')
  if (request.completed_at) return directResult(sql, request.id, false)

  baseClient ||= createPublicClient({ chain: base, transport: http(process.env.SENDU_BASE_RPC_URL || 'https://mainnet.base.org') })
  let receipt
  try { receipt = await baseClient.getTransactionReceipt({ hash: rawTxHash.toLowerCase() }) } catch { throw new Error('That Base transaction was not found or is not confirmed yet') }
  if (receipt.status !== 'success') throw new Error('That Base transaction did not succeed')
  const confirmations = await baseClient.getBlockNumber() - receipt.blockNumber + 1n
  if (confirmations < BigInt(DEPOSIT_CONFIRMATIONS)) throw new Error(`That transaction has ${confirmations} of ${DEPOSIT_CONFIRMATIONS} required confirmations`)
  if (getAddress(receipt.from) !== getAddress(request.sender_address)) throw new Error('The transaction was not sent by the linked sender wallet')
  const expected = BigInt(request.amount_raw)
  let matches = 0
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== KENDU_BASE_ADDRESS.toLowerCase()) continue
    try {
      const decoded = decodeEventLog({ abi: [TRANSFER_EVENT], data: log.data, topics: log.topics })
      if (getAddress(decoded.args.from) === getAddress(request.sender_address) && getAddress(decoded.args.to) === getAddress(request.recipient_address) && decoded.args.value === expected) matches += 1
    } catch { /* unrelated log */ }
  }
  if (matches !== 1) throw new Error(`The transaction does not contain the exact ${formatLiveKendu(expected)} Kendu transfer to the linked recipient wallet`)
  const txHash = rawTxHash.toLowerCase()
  const newlyCompleted = await sql.begin(async tx => {
    const [locked] = await tx`select * from sendu_direct_requests where id=${request.id} for update`
    if (locked.completed_at) return false
    if ((await tx`select id from sendu_direct_tips where tx_hash=${txHash}`).length) throw new Error('This transaction was already recorded')
    await tx`
      insert into sendu_direct_tips
        (id, request_id, sender_id, recipient_id, sender_address, recipient_address, amount_raw, tx_hash, block_number)
      values (${crypto.randomUUID()}, ${request.id}, ${request.sender_id}, ${request.recipient_id}, ${request.sender_address},
        ${request.recipient_address}, ${request.amount_raw}::numeric, ${txHash}, ${receipt.blockNumber.toString()}::bigint)
    `
    await tx`update sendu_direct_requests set tx_hash=${txHash}, completed_at=now() where id=${request.id}`
    return true
  })
  return directResult(sql, request.id, newlyCompleted)
}

async function completedDirectSenduByTransaction(rawTxHash, telegramId) {
  const txHash = String(rawTxHash).toLowerCase()
  const sql = await database()
  const [request] = await sql`
    select id from sendu_direct_requests
    where tx_hash=${txHash} and sender_id=${telegramId} and completed_at is not null
    limit 1
  `
  if (!request) throw new Error('No verified Kendu Sendu from your account matches that transaction hash')
  return directResult(sql, request.id, false)
}

async function directResult(sql, requestId, newlyCompleted) {
  const [row] = await sql`
    select r.*, sender.username sender_username, sender.display_name sender_name,
      recipient.username recipient_username, recipient.display_name recipient_name
    from sendu_direct_requests r join sendu_users sender on sender.telegram_id=r.sender_id
    join sendu_users recipient on recipient.telegram_id=r.recipient_id where r.id=${requestId}
  `
  return { ...row, newlyCompleted, amount: formatLiveKendu(row.amount_raw) }
}

export function directAnnouncementText(result) {
  return `<b>Kendu Sendu!</b> ${formatStoredUser(result.sender_name, result.sender_username)} sent ${formatStoredUser(result.recipient_name, result.recipient_username)} <b>${result.amount} Kendu</b>.\n\n<a href="https://basescan.org/tx/${result.tx_hash}">View Base transaction</a>`
}

export async function markDirectSenduAnnounced(requestId) {
  const sql = await database()
  await sql`update sendu_direct_requests set announced_at=coalesce(announced_at, now()) where id=${requestId}`
}

async function directLedgerText(sql) {
  const rows = await sql`
    select t.*, sender.username sender_username, sender.display_name sender_name, recipient.username recipient_username, recipient.display_name recipient_name
    from sendu_direct_tips t join sendu_users sender on sender.telegram_id=t.sender_id join sendu_users recipient on recipient.telegram_id=t.recipient_id
    order by t.created_at desc limit 10
  `
  if (!rows.length) return 'The Kendu Sendu ledger has no verified transfers yet.'
  return `<b>Kendu Sendu Ledger</b>\n\n${rows.map((r, i) => `${i + 1}. ${formatLedgerUser(r.sender_name, r.sender_username)} → ${formatLedgerUser(r.recipient_name, r.recipient_username)}\n<b>${formatLiveKendu(r.amount_raw)} Kendu</b> · ${formatLedgerTime(r.created_at)} · <a href="https://basescan.org/tx/${r.tx_hash}">TX</a>`).join('\n\n')}`
}

async function directHistoryText(sql, telegramId) {
  const rows = await sql`
    select t.*, sender.username sender_username, sender.display_name sender_name, recipient.username recipient_username, recipient.display_name recipient_name
    from sendu_direct_tips t join sendu_users sender on sender.telegram_id=t.sender_id join sendu_users recipient on recipient.telegram_id=t.recipient_id
    where t.sender_id=${telegramId} or t.recipient_id=${telegramId} order by t.created_at desc limit 10
  `
  if (!rows.length) return 'You have no verified Kendu Sendu history yet.'
  return `<b>Your Kendu Sendu History</b>\n\n${rows.map(r => `${String(r.sender_id) === String(telegramId) ? 'Sent to' : 'Received from'} ${String(r.sender_id) === String(telegramId) ? formatLedgerUser(r.recipient_name, r.recipient_username) : formatLedgerUser(r.sender_name, r.sender_username)}: <b>${formatLiveKendu(r.amount_raw)} Kendu</b> · <a href="https://basescan.org/tx/${r.tx_hash}">TX</a>`).join('\n')}`
}

async function directUsersText(sql) {
  const rows = await sql`
    select u.username, u.display_name from sendu_wallets w join sendu_users u on u.telegram_id=w.telegram_id
    where w.directory_visible=true order by lower(coalesce(u.username, u.display_name)) limit 100
  `
  if (!rows.length) return 'No registered Kendu Sendu users are currently visible.'
  return `<b>Registered Kendu Sendu Users</b>\n\n${rows.map(r => formatLedgerUser(r.display_name, r.username)).join('\n')}\n\nLinked users are listed by default. Opt out privately with <code>/sendu directory off</code>.`
}

async function directStatsText(sql) {
  const [senderRows, recipientRows] = await Promise.all([
    sql`
      select u.username, u.display_name, sum(t.amount_raw) as total_raw, count(*)::int as tip_count
      from sendu_direct_tips t join sendu_users u on u.telegram_id=t.sender_id
      group by u.telegram_id, u.username, u.display_name
      order by total_raw desc, tip_count desc limit 1
    `,
    sql`
      select u.username, u.display_name, sum(t.amount_raw) as total_raw, count(*)::int as tip_count
      from sendu_direct_tips t join sendu_users u on u.telegram_id=t.recipient_id
      group by u.telegram_id, u.username, u.display_name
      order by total_raw desc, tip_count desc limit 1
    `,
  ])
  if (!senderRows.length || !recipientRows.length) return 'Kendu Sendu stats will appear after the first verified transfer.'
  const sender = senderRows[0]
  const recipient = recipientRows[0]
  return [
    '<b>Kendu Sendu Stats</b>', '',
    '<b>Top Sender</b>',
    `${formatLedgerUser(sender.display_name, sender.username)} · <b>${formatLiveKendu(sender.total_raw)} Kendu</b> across ${sender.tip_count} ${sender.tip_count === 1 ? 'Sendu' : 'Sendus'}`, '',
    '<b>Top Recipient</b>',
    `${formatLedgerUser(recipient.display_name, recipient.username)} · <b>${formatLiveKendu(recipient.total_raw)} Kendu</b> across ${recipient.tip_count} ${recipient.tip_count === 1 ? 'Sendu' : 'Sendus'}`,
  ].join('\n')
}

function databaseUrl() {
  return process.env.TIPPING_DATABASE_URL || process.env.DATABASE_URL || ''
}

async function database() {
  const url = databaseUrl()
  if (!url) throw new Error('Sendu database is not configured')
  if (!sqlClient) sqlClient = postgres(url, { max: 1, idle_timeout: 20, connect_timeout: 10 })
  if (!schemaReady) schemaReady = ensureSchema(sqlClient).catch(error => {
    schemaReady = null
    throw error
  })
  await schemaReady
  return sqlClient
}

async function ensureSchema(sql) {
  await sql.begin(async tx => {
    await tx`select pg_advisory_xact_lock(724019551)`
    await tx`
      create table if not exists sendu_users (
        telegram_id bigint primary key,
        username text,
        display_name text not null,
        activated_at timestamptz,
        terms_version integer not null default 0,
        terms_accepted_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `
    await tx`alter table sendu_users add column if not exists terms_version integer not null default 0`
    await tx`alter table sendu_users add column if not exists terms_accepted_at timestamptz`
    await tx`create unique index if not exists sendu_users_username_lower_idx on sendu_users (lower(username)) where username is not null`
    await tx`
      create table if not exists sendu_wallets (
        telegram_id bigint primary key references sendu_users(telegram_id),
        address text not null unique check (address ~ '^0x[0-9a-f]{40}$'),
        linked_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `
    await tx`alter table sendu_wallets add column if not exists directory_visible boolean not null default true`
    await tx`alter table sendu_wallets alter column directory_visible set default true`
    await tx`alter table sendu_wallets add column if not exists directory_preference_set boolean not null default false`
    await tx`
      create table if not exists sendu_direct_requests (
        id uuid primary key,
        token_hash text not null unique,
        sender_id bigint not null references sendu_users(telegram_id),
        recipient_id bigint not null references sendu_users(telegram_id),
        sender_address text not null,
        recipient_address text not null,
        amount_raw numeric(78, 0) not null check (amount_raw > 0),
        chat_id bigint not null,
        expires_at timestamptz not null,
        tx_hash text unique,
        completed_at timestamptz,
        announced_at timestamptz,
        created_at timestamptz not null default now()
      )
    `
    await tx`
      create table if not exists sendu_direct_tips (
        id uuid primary key,
        request_id uuid not null unique references sendu_direct_requests(id),
        sender_id bigint not null references sendu_users(telegram_id),
        recipient_id bigint not null references sendu_users(telegram_id),
        sender_address text not null,
        recipient_address text not null,
        amount_raw numeric(78, 0) not null check (amount_raw > 0),
        tx_hash text not null unique,
        block_number bigint not null,
        created_at timestamptz not null default now()
      )
    `
    await tx`create index if not exists sendu_direct_tips_created_idx on sendu_direct_tips (created_at desc)`
    await tx`
      create table if not exists sendu_wallet_link_requests (
        token_hash text primary key,
        telegram_id bigint not null references sendu_users(telegram_id),
        wallet_address text,
        challenge text,
        challenge_expires_at timestamptz,
        attempt_count integer not null default 0,
        expires_at timestamptz not null,
        used_at timestamptz,
        created_at timestamptz not null default now()
      )
    `
    await tx`alter table sendu_wallet_link_requests add column if not exists verification_amount_raw numeric(78, 0)`
    await tx`alter table sendu_wallet_link_requests add column if not exists verification_tx_hash text`
    await tx`create index if not exists sendu_wallet_link_requests_user_idx on sendu_wallet_link_requests (telegram_id, created_at desc)`
    await tx`create unique index if not exists sendu_wallet_link_requests_active_amount_idx on sendu_wallet_link_requests (verification_amount_raw) where verification_amount_raw is not null and used_at is null`
    await tx`
      create table if not exists sendu_live_accounts (
        telegram_id bigint primary key references sendu_users(telegram_id),
        balance_raw numeric(78, 0) not null default 0 check (balance_raw >= 0),
        updated_at timestamptz not null default now()
      )
    `
    await tx`
      create table if not exists sendu_deposits (
        tx_hash text primary key,
        telegram_id bigint not null references sendu_users(telegram_id),
        from_address text not null,
        amount_raw numeric(78, 0) not null check (amount_raw > 0),
        block_number bigint not null,
        credited_at timestamptz not null default now()
      )
    `
    await tx`create index if not exists sendu_deposits_user_idx on sendu_deposits (telegram_id, credited_at desc)`
    await tx`
      create table if not exists sendu_live_tips (
        id uuid primary key,
        sender_id bigint not null references sendu_users(telegram_id),
        recipient_id bigint not null references sendu_users(telegram_id),
        amount_raw numeric(78, 0) not null check (amount_raw > 0),
        status text not null check (status in ('pending', 'claimed', 'expired')),
        expires_at timestamptz,
        claimed_at timestamptz,
        created_at timestamptz not null default now()
      )
    `
    await tx`create index if not exists sendu_live_tips_recipient_status_idx on sendu_live_tips (recipient_id, status, created_at)`
    await tx`
      create table if not exists sendu_live_ledger (
        id bigserial primary key,
        telegram_id bigint not null references sendu_users(telegram_id),
        amount_raw numeric(78, 0) not null check (amount_raw <> 0),
        kind text not null,
        reference_id text not null,
        created_at timestamptz not null default now()
      )
    `
    await tx`create index if not exists sendu_live_ledger_user_created_idx on sendu_live_ledger (telegram_id, created_at desc)`
    await tx`
      create table if not exists sendu_live_commands (
        command_key text primary key,
        created_at timestamptz not null default now()
      )
    `
    await tx`
      create table if not exists sendu_withdrawals (
        id uuid primary key,
        telegram_id bigint not null references sendu_users(telegram_id),
        to_address text not null check (to_address ~ '^0x[0-9a-f]{40}$'),
        amount_raw numeric(78, 0) not null check (amount_raw > 0),
        status text not null check (status in ('pending', 'processing', 'broadcasting', 'sent', 'confirmed', 'failed')),
        raw_transaction text,
        tx_hash text unique,
        error text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        confirmed_at timestamptz
      )
    `
    await tx`create index if not exists sendu_withdrawals_status_idx on sendu_withdrawals (status, created_at)`
    await tx`create index if not exists sendu_withdrawals_user_idx on sendu_withdrawals (telegram_id, created_at desc)`
    await tx`alter table sendu_withdrawals add column if not exists automatic boolean not null default false`
    await tx`alter table sendu_withdrawals add column if not exists reason text`
    await tx`
      create table if not exists sendu_action_requests (
        token_hash text primary key,
        telegram_id bigint not null references sendu_users(telegram_id),
        action text not null check (action in ('deposit', 'withdraw')),
        wallet_address text not null,
        amount_raw numeric(78, 0),
        challenge text,
        challenge_expires_at timestamptz,
        expires_at timestamptz not null,
        used_at timestamptz,
        created_at timestamptz not null default now()
      )
    `
    await tx`create index if not exists sendu_action_requests_user_idx on sendu_action_requests (telegram_id, created_at desc)`
    await tx`
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
    await tx`insert into sendu_system_status (id) values (true) on conflict do nothing`
    await tx`
      insert into sendu_live_accounts (telegram_id)
      select telegram_id from sendu_users
      on conflict do nothing
    `
    await tx`
      insert into sendu_live_ledger (telegram_id, amount_raw, kind, reference_id, created_at)
      select d.telegram_id, d.amount_raw, 'deposit', d.tx_hash, d.credited_at
      from sendu_deposits d
      where not exists (
        select 1 from sendu_live_ledger l where l.kind = 'deposit' and l.reference_id = d.tx_hash
      )
    `
  })
}

async function upsertUser(sql, from) {
  const name = [from.first_name, from.last_name].filter(Boolean).join(' ').trim() || from.username || `User ${from.id}`
  await sql.begin(async tx => {
    if (from.username) {
      await tx`
        update sendu_users
        set username = null, updated_at = now()
        where lower(username) = ${from.username.toLowerCase()} and telegram_id <> ${from.id}
      `
    }
    await tx`
      insert into sendu_users (telegram_id, username, display_name)
      values (${from.id}, ${from.username || null}, ${name})
      on conflict (telegram_id) do update set
        username = excluded.username,
        display_name = excluded.display_name,
        updated_at = now()
    `
    await tx`insert into sendu_live_accounts (telegram_id) values (${from.id}) on conflict do nothing`
  })
}

async function hasAcceptedTerms(sql, telegramId) {
  const rows = await sql`select terms_version from sendu_users where telegram_id = ${telegramId}`
  return Number(rows[0]?.terms_version || 0) >= TERMS_VERSION
}

async function linkedWallet(sql, telegramId) {
  const rows = await sql`select address from sendu_wallets where telegram_id = ${telegramId}`
  return rows[0]?.address ? getAddress(rows[0].address) : null
}

async function linkedWalletBalanceText(address) {
  baseClient ||= createPublicClient({
    chain: base,
    transport: http(process.env.SENDU_BASE_RPC_URL || 'https://mainnet.base.org'),
  })
  const [kenduRaw, gasWei] = await Promise.all([
    baseClient.readContract({
      address: KENDU_BASE_ADDRESS,
      abi: [BALANCE_OF_FUNCTION],
      functionName: 'balanceOf',
      args: [address],
    }),
    baseClient.getBalance({ address }),
  ])
  const gasBalance = Number(formatUnits(gasWei, 18)).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 8,
  })
  return [
    '<b>Kendu Sendu Wallet Balance</b>',
    '',
    `<b>Base Kendu:</b> ${formatKenduToTwoDecimals(kenduRaw)} Kendu`,
    `<b>Base ETH (gas):</b> ${gasBalance} ETH`,
    '',
    `<code>${escapeHtml(address)}</code>`,
  ].join('\n')
}

async function createSenduActionLink(sql, telegramId, action) {
  const address = await linkedWallet(sql, telegramId)
  if (!address) return { text: 'Link your wallet first with <code>/sendu link</code>.' }
  if (action === 'deposit') {
    const limits = await currentSenduLimits(sql)
    const [account] = await sql`select balance_raw from sendu_live_accounts where telegram_id = ${telegramId}`
    const [pending] = await sql`select coalesce(sum(amount_raw), 0) as amount_raw from sendu_live_tips where recipient_id = ${telegramId} and status = 'pending' and expires_at > now()`
    const exposureRaw = BigInt(account?.balance_raw || 0) + BigInt(pending?.amount_raw || 0)
    if (exposureRaw >= limits.userCapRaw) return { text: '<b>Deposit paused</b>\nYour Sendu allocation is at its current safety cap. Withdraw or send tips before depositing again.' }
    if (limits.walletBalanceRaw >= limits.globalCapRaw) return { text: '<b>Deposits paused</b>\nThe Sendu community wallet is at its global custody ceiling.' }
  }
  const token = crypto.randomBytes(32).toString('base64url')
  const tokenHash = hashToken(token)
  await sql.begin(async tx => {
    await tx`delete from sendu_action_requests where telegram_id = ${telegramId} and action = ${action} and used_at is null`
    await tx`
      insert into sendu_action_requests (token_hash, telegram_id, action, wallet_address, expires_at)
      values (${tokenHash}, ${telegramId}, ${action}, ${address.toLowerCase()}, now() + (${ACTION_LINK_MINUTES} * interval '1 minute'))
    `
  })
  const baseUrl = String(process.env.SENDU_DASHBOARD_URL || 'https://kendu-dashboard.com').replace(/\/$/, '')
  const url = `${baseUrl}/sendu/${action}#token=${encodeURIComponent(token)}`
  const label = action === 'deposit' ? 'Deposit Kendu' : 'Withdraw Kendu'
  const text = action === 'deposit'
    ? [
        '<b>Deposit Kendu</b>',
        '',
        '<b>Option 1: WalletConnect</b>',
        'Use the button below to connect your linked wallet, enter an amount, and approve the Base Kendu transfer.',
        '',
        '<b>Option 2: Transaction Hash</b>',
        'Send Base Kendu from your linked wallet to:',
        `<code>${COMMUNITY_WALLET_ADDRESS}</code>`,
        '',
        'After it confirms, send:',
        '<code>/sendu deposit claim TX_HASH</code>',
        '',
        '<b>Only Base Kendu sent from your linked wallet can be credited.</b>',
        '',
        `WalletConnect link: <code>${escapeHtml(url)}</code>`,
        '',
        `The WalletConnect link expires in ${ACTION_LINK_MINUTES} minutes. Open it in Safari or your normal browser; Telegram's built-in browser is not supported.`,
      ].join('\n')
    : [
        '<b>Withdraw Kendu</b>',
        '',
        '<b>Option 1: WalletConnect</b>',
        'Use the button below to connect your linked wallet and sign a free authorization for the withdrawal.',
        '',
        '<b>Option 2: Telegram</b>',
        'Withdraw directly to your linked wallet with:',
        '<code>/sendu withdraw 1m</code>',
        '',
        `Destination: <code>${escapeHtml(address)}</code>`,
        '',
        'Check recent requests with:',
        '<code>/sendu withdraw status</code>',
        '',
        `WalletConnect link: <code>${escapeHtml(url)}</code>`,
        '',
        `The WalletConnect link expires in ${ACTION_LINK_MINUTES} minutes. Open it in Safari or your normal browser; Telegram's built-in browser is not supported.`,
      ].join('\n')
  return {
    text,
    options: { reply_markup: { inline_keyboard: [[{ text: `${label} with WalletConnect`, url }]] } },
  }
}

async function claimLiveDeposit(sql, telegramId, linkedAddress, rawTxHash) {
  const txHash = rawTxHash.toLowerCase()
  const existing = await sql`select telegram_id from sendu_deposits where tx_hash = ${txHash}`
  if (existing.length) throw new Error('This deposit transaction has already been claimed')

  baseClient ||= createPublicClient({
    chain: base,
    transport: http(process.env.SENDU_BASE_RPC_URL || 'https://mainnet.base.org'),
  })

  let receipt
  try {
    receipt = await baseClient.getTransactionReceipt({ hash: txHash })
  } catch {
    throw new Error('That Base transaction was not found or is not confirmed yet')
  }
  if (receipt.status !== 'success') throw new Error('That Base transaction did not succeed')

  const latestBlock = await baseClient.getBlockNumber()
  const confirmations = latestBlock - receipt.blockNumber + 1n
  if (confirmations < BigInt(DEPOSIT_CONFIRMATIONS)) {
    throw new Error(`That deposit has ${confirmations} of ${DEPOSIT_CONFIRMATIONS} required confirmations`)
  }

  const expectedFrom = getAddress(linkedAddress)
  let amountRaw = 0n
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== KENDU_BASE_ADDRESS.toLowerCase()) continue
    try {
      const decoded = decodeEventLog({ abi: [TRANSFER_EVENT], data: log.data, topics: log.topics })
      if (getAddress(decoded.args.from) === expectedFrom && getAddress(decoded.args.to) === COMMUNITY_WALLET_ADDRESS) {
        amountRaw += decoded.args.value
      }
    } catch {
      // Ignore unrelated logs emitted by the token transaction.
    }
  }
  if (amountRaw <= 0n) {
    throw new Error('No Kendu transfer from your linked wallet to the Sendu community wallet was found in that transaction')
  }
  const limits = await currentSenduLimits(sql)

  return sql.begin(async tx => {
    const inserted = await tx`
      insert into sendu_deposits (tx_hash, telegram_id, from_address, amount_raw, block_number)
      values (${txHash}, ${telegramId}, ${expectedFrom.toLowerCase()}, ${amountRaw.toString()}::numeric, ${receipt.blockNumber.toString()}::bigint)
      on conflict do nothing
      returning tx_hash
    `
    if (!inserted.length) throw new Error('This deposit transaction has already been claimed')
    await tx`insert into sendu_live_accounts (telegram_id) values (${telegramId}) on conflict do nothing`
    const [creditedAccount] = await tx`
      update sendu_live_accounts
      set balance_raw = balance_raw + ${amountRaw.toString()}::numeric, updated_at = now()
      where telegram_id = ${telegramId}
      returning balance_raw
    `
    await tx`
      insert into sendu_live_ledger (telegram_id, amount_raw, kind, reference_id)
      values (${telegramId}, ${amountRaw.toString()}::numeric, 'deposit', ${txHash})
    `
    const creditedBalanceRaw = BigInt(creditedAccount.balance_raw)
    const capReached = creditedBalanceRaw >= limits.userCapRaw
    const globalCapReached = limits.walletBalanceRaw + amountRaw >= limits.globalCapRaw
    const autoWithdrawal = capReached || globalCapReached
      ? await queueAutomaticWithdrawalTx(tx, {
          telegramId,
          address: expectedFrom,
          amountRaw: creditedBalanceRaw,
          reason: capReached ? 'user_cap' : 'global_cap',
        })
      : null
    return { txHash, amountRaw, balanceRaw: autoWithdrawal?.balanceRaw ?? creditedBalanceRaw, autoWithdrawal }
  })
}

function depositInstructions() {
  return [
    '<b>Deposit Kendu on Base</b>',
    '',
    'Send only Base Kendu from your linked wallet to:',
    `<code>${COMMUNITY_WALLET_ADDRESS}</code>`,
    '',
    `Kendu contract: <code>${KENDU_BASE_ADDRESS}</code>`,
    '',
    'After the transfer confirms, send:',
    '<code>/sendu deposit [transaction hash]</code>',
    '',
    '<b>Do not send from an exchange or a different wallet. Deposits on another network cannot be credited.</b>',
  ].join('\n')
}

async function queueAutomaticWithdrawalTx(tx, { telegramId, address, amountRaw, reason }) {
  if (amountRaw <= 0n) return null
  const id = crypto.randomUUID()
  const [account] = await tx`
    update sendu_live_accounts
    set balance_raw = balance_raw - ${amountRaw.toString()}::numeric, updated_at = now()
    where telegram_id = ${telegramId} and balance_raw >= ${amountRaw.toString()}::numeric
    returning balance_raw
  `
  if (!account) throw new Error('Unable to reserve the automatic Sendu payout')
  await tx`
    insert into sendu_withdrawals (id, telegram_id, to_address, amount_raw, status, automatic, reason)
    values (${id}, ${telegramId}, ${address.toLowerCase()}, ${amountRaw.toString()}::numeric, 'pending', true, ${reason})
  `
  await tx`
    insert into sendu_live_ledger (telegram_id, amount_raw, kind, reference_id)
    values (${telegramId}, ${(-amountRaw).toString()}::numeric, 'withdrawal_reserved', ${id})
  `
  return { id, amountRaw, balanceRaw: BigInt(account.balance_raw) }
}

async function requestWithdrawal(sql, { telegramId, address, amountRaw, key }) {
  return sql.begin(async tx => {
    if (!await registerCommand(tx, key)) return { duplicate: true }
    const [account] = await tx`select balance_raw from sendu_live_accounts where telegram_id = ${telegramId} for update`
    const balanceRaw = BigInt(account?.balance_raw || 0)
    if (balanceRaw < amountRaw) return { insufficient: true, balanceRaw }

    const id = crypto.randomUUID()
    await tx`
      update sendu_live_accounts
      set balance_raw = balance_raw - ${amountRaw.toString()}::numeric, updated_at = now()
      where telegram_id = ${telegramId}
    `
    await tx`
      insert into sendu_withdrawals (id, telegram_id, to_address, amount_raw, status)
      values (${id}, ${telegramId}, ${address.toLowerCase()}, ${amountRaw.toString()}::numeric, 'pending')
    `
    await tx`
      insert into sendu_live_ledger (telegram_id, amount_raw, kind, reference_id)
      values (${telegramId}, ${(-amountRaw).toString()}::numeric, 'withdrawal_reserved', ${id})
    `
    return { id, amountRaw }
  })
}

async function withdrawalStatusText(sql, telegramId) {
  const rows = await sql`
    select id, amount_raw, status, tx_hash, error, created_at
    from sendu_withdrawals
    where telegram_id = ${telegramId}
    order by created_at desc
    limit 5
  `
  if (!rows.length) return 'No Sendu withdrawal requests yet.'
  const lines = rows.map(row => {
    const link = row.tx_hash ? ` · <a href="https://basescan.org/tx/${row.tx_hash}">transaction</a>` : ''
    const error = row.status === 'failed' && row.error ? `\n${escapeHtml(row.error)}` : ''
    return `<b>${formatLiveKendu(row.amount_raw)} Kendu</b> · ${escapeHtml(row.status)}${link}\n<code>${row.id}</code>${error}`
  })
  return `<b>Recent Sendu Withdrawals</b>\n\n${lines.join('\n\n')}`
}

function withdrawalInstructions(address) {
  return [
    '<b>Withdraw Kendu on Base</b>',
    '',
    `Destination: <code>${escapeHtml(address)}</code>`,
    '',
    'Request a withdrawal:',
    '<code>/sendu withdraw [amount]</code>',
    '',
    'Check recent requests:',
    '<code>/sendu withdraw status</code>',
    '',
    `Limits: ${formatTokens(MIN_WITHDRAWAL)} to ${formatTokens(MAX_WITHDRAWAL)} Kendu per withdrawal.`,
  ].join('\n')
}

function formatLiveKendu(rawAmount) {
  const [whole, fraction = ''] = formatUnits(BigInt(String(rawAmount)), 18).split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const trimmed = fraction.replace(/0+$/, '').slice(0, 6)
  return trimmed ? `${grouped}.${trimmed}` : grouped
}

function formatKenduToTwoDecimals(rawAmount) {
  const roundedHundredths = (BigInt(String(rawAmount)) + (5n * 10n ** 15n)) / (10n ** 16n)
  const whole = roundedHundredths / 100n
  const fraction = String(roundedHundredths % 100n).padStart(2, '0')
  return `${whole.toLocaleString('en-US')}.${fraction}`
}

async function resolveTarget(sql, message, username) {
  if (message.reply_to_message?.from?.id && !username) return message.reply_to_message.from
  if (!username) return null
  const clean = username.replace(/^@/, '').toLowerCase()
  const rows = await sql`select telegram_id, username, display_name from sendu_users where lower(username) = ${clean} limit 1`
  if (!rows.length) return null
  return { id: rows[0].telegram_id, username: rows[0].username, first_name: rows[0].display_name }
}

function parseSend(text, message) {
  const withUser = text.match(/^(@[A-Za-z0-9_]+)\s+([\d,.]+\s*[kmb]?)\s*(?:kendu)?$/i)
  if (withUser) return { username: withUser[1], amount: parseWholeTokens(withUser[2]) }
  const reply = text.match(/^([\d,.]+\s*[kmb]?)\s*(?:kendu)?$/i)
  if (reply && message.reply_to_message?.from?.id) return { username: null, amount: parseWholeTokens(reply[1]) }
  return null
}

async function registerCommand(tx, key) {
  const rows = await tx`insert into sendu_live_commands (command_key) values (${key}) on conflict do nothing returning command_key`
  return rows.length > 0
}

async function sendTip(sql, { senderId, recipientId, amountRaw, commandKey: key }) {
  const limits = await currentSenduLimits(sql)
  return sql.begin(async tx => {
    if (!await registerCommand(tx, key)) return { duplicate: true }
    const locked = await tx`select telegram_id, balance_raw from sendu_live_accounts where telegram_id in (${senderId}, ${recipientId}) order by telegram_id for update`
    const sender = locked.find(row => String(row.telegram_id) === String(senderId))
    const recipientAccountRow = locked.find(row => String(row.telegram_id) === String(recipientId))
    const senderBalanceRaw = BigInt(sender?.balance_raw || 0)
    if (senderBalanceRaw < amountRaw) return { insufficient: true, balanceRaw: senderBalanceRaw }

    const recipientRows = await tx`select activated_at, terms_version from sendu_users where telegram_id = ${recipientId}`
    const pending = !recipientRows[0]?.activated_at || Number(recipientRows[0]?.terms_version || 0) < TERMS_VERSION
    const pendingRows = await tx`select id, amount_raw from sendu_live_tips where recipient_id = ${recipientId} and status = 'pending' and expires_at > now() for update`
    const pendingRaw = pendingRows.reduce((sum, row) => sum + BigInt(row.amount_raw), 0n)
    const recipientExposureRaw = BigInt(recipientAccountRow?.balance_raw || 0) + pendingRaw
    const [wallet] = await tx`select address from sendu_wallets where telegram_id = ${recipientId} for update`
    const wouldExceedCap = recipientExposureRaw + amountRaw > limits.userCapRaw
    if (wouldExceedCap && (pending || !wallet)) return { capBlocked: true, capRaw: limits.userCapRaw }
    if (wouldExceedCap && !withdrawalsEnabled()) return { capBlocked: true, capRaw: limits.userCapRaw }
    const tipId = crypto.randomUUID()
    const senderRows = await tx`update sendu_live_accounts set balance_raw = balance_raw - ${amountRaw.toString()}::numeric, updated_at = now() where telegram_id = ${senderId} returning balance_raw`
    await tx`insert into sendu_live_ledger (telegram_id, amount_raw, kind, reference_id) values (${senderId}, ${(-amountRaw).toString()}::numeric, 'tip_sent', ${tipId})`

    let recipientBalanceRaw = null
    if (pending) {
      await tx`
        insert into sendu_live_tips (id, sender_id, recipient_id, amount_raw, status, expires_at)
        values (${tipId}, ${senderId}, ${recipientId}, ${amountRaw.toString()}::numeric, 'pending', now() + (${CLAIM_DAYS} * interval '1 day'))
      `
    } else {
      await tx`
        insert into sendu_live_tips (id, sender_id, recipient_id, amount_raw, status, claimed_at)
        values (${tipId}, ${senderId}, ${recipientId}, ${amountRaw.toString()}::numeric, 'claimed', now())
      `
      const recipientAccount = await tx`update sendu_live_accounts set balance_raw = balance_raw + ${amountRaw.toString()}::numeric, updated_at = now() where telegram_id = ${recipientId} returning balance_raw`
      recipientBalanceRaw = BigInt(recipientAccount[0].balance_raw)
      await tx`insert into sendu_live_ledger (telegram_id, amount_raw, kind, reference_id) values (${recipientId}, ${amountRaw.toString()}::numeric, 'tip_received', ${tipId})`
    }
    let autoWithdrawal = null
    if (!pending && wallet && recipientBalanceRaw >= limits.userCapRaw) {
      if (!withdrawalsEnabled()) throw new Error('Automatic Sendu payouts are temporarily paused')
      autoWithdrawal = await queueAutomaticWithdrawalTx(tx, {
        telegramId: recipientId,
        address: getAddress(wallet.address),
        amountRaw: recipientBalanceRaw,
        reason: 'user_cap',
      })
      recipientBalanceRaw = autoWithdrawal.balanceRaw
    }
    return { pending, senderBalanceRaw: BigInt(senderRows[0].balance_raw), recipientBalanceRaw, autoWithdrawal }
  })
}

async function claimPending(sql, telegramId, key) {
  const limits = await currentSenduLimits(sql)
  return sql.begin(async tx => {
    if (!await registerCommand(tx, key)) return { duplicate: true }
    await tx`select telegram_id from sendu_live_accounts where telegram_id = ${telegramId} for update`
    const tips = await tx`select id, amount_raw from sendu_live_tips where recipient_id = ${telegramId} and status = 'pending' and expires_at > now() order by created_at for update`
    const amountRaw = tips.reduce((sum, tip) => sum + BigInt(tip.amount_raw), 0n)
    const [accountBefore] = await tx`select balance_raw from sendu_live_accounts where telegram_id = ${telegramId}`
    const [wallet] = await tx`select address from sendu_wallets where telegram_id = ${telegramId} for update`
    const resultingBalanceRaw = BigInt(accountBefore?.balance_raw || 0) + amountRaw
    if (resultingBalanceRaw > limits.userCapRaw && !wallet) return { capBlocked: true, capRaw: limits.userCapRaw }
    if (resultingBalanceRaw > limits.userCapRaw && !withdrawalsEnabled()) return { capBlocked: true, capRaw: limits.userCapRaw }
    await tx`update sendu_users set activated_at = coalesce(activated_at, now()), updated_at = now() where telegram_id = ${telegramId}`
    if (amountRaw > 0n) {
      const ids = tips.map(tip => tip.id)
      await tx`update sendu_live_tips set status = 'claimed', claimed_at = now() where id in ${tx(ids)}`
      await tx`update sendu_live_accounts set balance_raw = balance_raw + ${amountRaw.toString()}::numeric, updated_at = now() where telegram_id = ${telegramId}`
      for (const tip of tips) {
        await tx`insert into sendu_live_ledger (telegram_id, amount_raw, kind, reference_id) values (${telegramId}, ${tip.amount_raw}::numeric, 'tip_received', ${tip.id})`
      }
    }
    const rows = await tx`select balance_raw from sendu_live_accounts where telegram_id = ${telegramId}`
    let balanceRaw = BigInt(rows[0]?.balance_raw || 0)
    let autoWithdrawal = null
    if (amountRaw > 0n && wallet && balanceRaw >= limits.userCapRaw) {
      autoWithdrawal = await queueAutomaticWithdrawalTx(tx, {
        telegramId,
        address: getAddress(wallet.address),
        amountRaw: balanceRaw,
        reason: 'user_cap',
      })
      balanceRaw = autoWithdrawal.balanceRaw
    }
    return { amountRaw, balanceRaw, autoWithdrawal }
  })
}

async function expirePendingTips(sql) {
  await sql.begin(async tx => {
    const expired = await tx`select id, sender_id, amount_raw from sendu_live_tips where status = 'pending' and expires_at <= now() order by sender_id for update skip locked`
    for (const tip of expired) {
      await tx`update sendu_live_tips set status = 'expired' where id = ${tip.id} and status = 'pending'`
      await tx`update sendu_live_accounts set balance_raw = balance_raw + ${tip.amount_raw}::numeric, updated_at = now() where telegram_id = ${tip.sender_id}`
      await tx`insert into sendu_live_ledger (telegram_id, amount_raw, kind, reference_id) values (${tip.sender_id}, ${tip.amount_raw}::numeric, 'tip_returned', ${tip.id})`
    }
  })
}

async function balanceText(sql, telegramId) {
  const [account] = await sql`select balance_raw from sendu_live_accounts where telegram_id = ${telegramId}`
  const [pending] = await sql`select coalesce(sum(amount_raw), 0) as amount_raw from sendu_live_tips where recipient_id = ${telegramId} and status = 'pending' and expires_at > now()`
  let capLine = 'Safety cap: temporarily unavailable'
  try {
    const limits = await currentSenduLimits(sql)
    capLine = `Current safety cap: <b>${formatLiveKendu(limits.userCapRaw)} Kendu</b> (lower of 10m Kendu or approximately $500)`
  } catch {
    // Balance lookup remains available while safety checks fail closed.
  }
  return [
    '<b>Sendu Balance</b>',
    `Available: <b>${formatLiveKendu(account?.balance_raw || 0)} Kendu</b>`,
    `Pending to claim: <b>${formatLiveKendu(pending?.amount_raw || 0)} Kendu</b>`,
    capLine,
    '',
    '<i>Custodial balance backed by Kendu held in the Sendu community wallet.</i>',
  ].join('\n')
}

async function historyText(sql, telegramId) {
  const rows = await sql`
    select t.amount_raw, t.status, t.created_at, t.sender_id, t.recipient_id,
      sender.display_name as sender_name, sender.username as sender_username,
      recipient.display_name as recipient_name, recipient.username as recipient_username
    from sendu_live_tips t
    join sendu_users sender on sender.telegram_id = t.sender_id
    join sendu_users recipient on recipient.telegram_id = t.recipient_id
    where t.sender_id = ${telegramId} or t.recipient_id = ${telegramId}
    order by t.created_at desc
    limit 10
  `
  if (!rows.length) return 'No Sendu tip history yet.'
  const lines = rows.map(row => {
    const sent = String(row.sender_id) === String(telegramId)
    const other = sent
      ? formatStoredUser(row.recipient_name, row.recipient_username)
      : formatStoredUser(row.sender_name, row.sender_username)
    const status = row.status === 'pending' ? ' (pending)' : row.status === 'expired' ? ' (returned)' : ''
    return `${sent ? 'Sent to' : 'Received from'} ${other}: <b>${formatLiveKendu(row.amount_raw)} Kendu</b>${status}`
  })
  return `<b>Recent Sendu Tips</b>\n${lines.join('\n')}`
}

async function ledgerText(sql, requestedPage) {
  const pageSize = 10
  const [{ count }] = await sql`select count(*)::int as count from sendu_live_tips`
  const total = Number(count || 0)
  if (!total) return 'The Sendu ledger has no transactions yet.'

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(requestedPage, totalPages)
  const offset = (page - 1) * pageSize
  const rows = await sql`
    select t.amount_raw, t.status, t.created_at,
      sender.display_name as sender_name, sender.username as sender_username,
      recipient.display_name as recipient_name, recipient.username as recipient_username
    from sendu_live_tips t
    join sendu_users sender on sender.telegram_id = t.sender_id
    join sendu_users recipient on recipient.telegram_id = t.recipient_id
    order by t.created_at desc
    limit ${pageSize} offset ${offset}
  `

  const lines = rows.map((row, index) => {
    const sender = formatLedgerUser(row.sender_name, row.sender_username)
    const recipient = formatLedgerUser(row.recipient_name, row.recipient_username)
    const status = row.status === 'pending' ? 'pending' : row.status === 'expired' ? 'returned' : 'claimed'
    return [
      `<b>${offset + index + 1}.</b> ${sender} → ${recipient}`,
      `${formatLiveKendu(row.amount_raw)} Kendu · ${status} · ${formatLedgerTime(row.created_at)}`,
    ].join('\n')
  })

  const footer = totalPages > 1
    ? `\n\nPage ${page} of ${totalPages} · <code>/sendu ledger ${page < totalPages ? page + 1 : 1}</code>`
    : ''
  return `<b>Sendu Community Ledger</b>\n\n${lines.join('\n\n')}${footer}`
}

function commandKey(message, action) {
  return `${message.chat.id}:${message.message_id}:${action}`
}

function displayName(user) {
  if (user.username) return `@${escapeHtml(user.username)}`
  return escapeHtml(user.first_name || user.display_name || `User ${user.id}`)
}

function formatStoredUser(name, username) {
  return username ? `@${escapeHtml(username)}` : escapeHtml(name)
}

function formatLedgerUser(name, username) {
  return escapeHtml(username || name)
}

function formatLedgerTime(value) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(value))
}

function usageText() {
  if (DIRECT_MODE) return [
    '<b>KENDU SENDU</b>', '',
    '<b>[PUBLIC CHAT COMMANDS]</b>', '',
    'How it works: <code>/sendu FAQ</code>',
    'Reply to someone: <code>/sendu 1000</code>',
    'Known user: <code>/sendu @user 1000</code>', '',
    'Your history: <code>/sendu history</code>',
    'Community ledger: <code>/sendu ledger</code>',
    'Community stats: <code>/sendu stats</code>',
    'Wallet directory: <code>/sendu users</code>', '',
    '<b>[PRIVATE CHAT COMMANDS]</b>', '',
    'Initial setup: <code>/sendu setup</code>',
    'Link wallet: <code>/sendu link</code>',
    'View linked wallet: <code>/sendu wallet</code>',
    'Wallet balances: <code>/sendu balance</code>',
    'Unlink wallet: <code>/sendu unlink</code>',
    'Show in directory: <code>/sendu directory on</code>',
    'Hide from directory: <code>/sendu directory off</code>',
    'Registered users: <code>/sendu users</code>',
    'Your history: <code>/sendu history</code>',
    'Community ledger: <code>/sendu ledger</code>',
    'Community stats: <code>/sendu stats</code>',
  ].join('\n')
  return [
    '<b>KENDU SENDU</b>',
    '',
    '<b>[PUBLIC CHAT COMMANDS]</b>',
    '',
    'How it works: <code>/sendu FAQ</code>',
    '',
    'Reply to someone: <code>/sendu 1000</code>',
    'Known user: <code>/sendu @user 1000</code>',
    '',
    'Claim pending tips: <code>/sendu claim</code>',
    'Balance: <code>/sendu balance</code>',
    '',
    'History: <code>/sendu history</code>',
    'Community ledger: <code>/sendu ledger</code>',
    '',
    '<b>[PRIVATE CHAT COMMANDS]</b>',
    '',
    'Initial setup: <code>/sendu setup</code>',
    '',
    'Link wallet: <code>/sendu link</code>',
    'View linked wallet: <code>/sendu wallet</code>',
    'Unlink wallet: <code>/sendu unlink</code>',
    '',
    'Deposit Kendu: <code>/sendu deposit</code>',
    'Withdraw Kendu: <code>/sendu withdraw</code>',
  ].join('\n')
}

function setupText(walletLinked, address = '') {
  if (DIRECT_MODE) return [
    '<b>KENDU SENDU SETUP</b>', '',
    '1. Review and accept the Sendu terms in this private chat.',
    '2. Link a Base wallet with <code>/sendu link</code>.',
    '3. Use <code>/sendu @user 1000</code> in an enabled public chat.', '',
    'Every Sendu is approved in your wallet and transfers directly to the recipient. Sendu never holds your Kendu.', '',
    '<b>Privacy recommendation:</b> Create a fresh Base wallet specifically for Kendu Sendu. The linked wallet address will be publicly visible on Base and associated with your Telegram identity through Sendu transactions.', '',
    walletLinked ? `<b>Status:</b> Ready.\n<code>${escapeHtml(address)}</code>` : '<b>Status:</b> Wallet not linked yet.',
  ].join('\n')
  return [
    '<b>KENDU SENDU SETUP</b>',
    '',
    '1. Review and accept the Sendu terms in this private chat.',
    '2. Link a Base wallet with <code>/sendu link</code>.',
    '3. Deposit Base Kendu with <code>/sendu deposit</code>.',
    '',
    walletLinked
      ? `<b>Status:</b> Terms accepted and wallet linked.\n<code>${escapeHtml(address)}</code>`
      : '<b>Status:</b> Wallet not linked yet.',
  ].join('\n')
}

function faqText() {
  if (DIRECT_MODE) return [
    '<b>KENDU SENDU FAQ</b>', '',
    '<b>How does Kendu Sendu work?</b>',
    'The bot creates a single-use request for an exact amount and recipient. Your wallet approves a normal Base Kendu transfer directly to the recipient wallet.', '',
    '<b>Does the bot hold funds or private keys?</b>',
    'No. The bot never takes custody of Kendu and never receives wallet private keys.', '',
    '<b>Does every Sendu require wallet approval?</b>',
    'Yes. The sender approves each on-chain transfer and pays the small Base network fee.', '',
    '<b>What does the ledger contain?</b>',
    'Only Base transactions verified against the exact linked sender, linked recipient, token, and amount are recorded.', '',
    '<b>Can I receive before linking a wallet?</b>',
    'No. Both people must accept the terms and link a wallet first.',
  ].join('\n')
  return [
    '<b>KENDU SENDU FAQ</b>',
    '',
    '<b>How does Sendu work?</b>',
    'Members deposit Kendu into a shared community wallet. Sendu tracks each member\'s allocated balance in an internal ledger, allowing instant tips without an on-chain transaction for every tip.',
    '',
    '<b>Is Sendu a personal wallet?</b>',
    'No. Sendu is custodial. Deposited Kendu is held in the community wallet until it is withdrawn.',
    '',
    '<b>Does tipping require a wallet transaction?</b>',
    'No. Tips move allocated balances inside the Sendu ledger and do not require gas.',
    '',
    '<b>Can someone receive tips before setup?</b>',
    `Yes. Pending tips can be claimed within ${CLAIM_DAYS} days after the recipient accepts the terms. Otherwise, they return to the sender.`,
    '',
    '<b>Are withdrawals available?</b>',
    'Yes. Withdrawals go only to the verified linked wallet and may be initiated with WalletConnect or a private Telegram command.',
    '',
    '<b>What are the balance limits?</b>',
    'Each user is limited to the lower of 10,000,000 Kendu or approximately $500 of Kendu based on the current reference price. Pending tips count toward this limit. The community wallet also has an approximately $5,000 global custody ceiling.',
    '',
    '<b>What happens at the cap?</b>',
    'A linked user is automatically paid out to their verified wallet. An unlinked user cannot receive additional tips until their allocation falls below the cap or they link a wallet.',
    '',
    '<b>Is this intended for large balances?</b>',
    'No. Sendu is for small, recreational community tips only.',
  ].join('\n')
}

function termsText() {
  if (DIRECT_MODE) return [
    '<b>Important Kendu Sendu Notice</b>', '',
    'Use of Kendu Sendu requires agreeing to the following terms.', '',
    '<b>Kendu Sendu is for small, recreational community tips only.</b>', '',
    'Kendu Sendu is non-custodial. Kendu moves directly from the sender\'s linked wallet to the recipient\'s linked wallet through a normal Base transaction. The bot does not hold funds, operate an intermediary wallet, or receive private keys.', '',
    'Every transfer requires approval in the sender\'s wallet. The sender pays Base network fees. Blockchain transfers are public and irreversible; verify the recipient and amount before approving.', '',
    `Kendu Sendu supports Base Kendu [<code>${KENDU_BASE_ADDRESS}</code>]. The public ledger records only transactions verified against the requested sender, recipient, token, and amount.`, '',
    'Linked wallet addresses and completed transactions are public blockchain data. Linked users appear by Telegram name in the Sendu directory by default; you may opt out privately with <code>/sendu directory off</code>.', '',
    'Do not use Sendu for savings, investing, trading, payments, or significant value. Wallet software, network congestion, malicious links, account compromise, and service changes can cause loss or interruption.', '',
    'By using Kendu Sendu, you acknowledge its experimental nature, public on-chain records, irreversible transfers, and responsibility for reviewing every wallet request before approval.',
  ].join('\n')
  return [
    '<b>Important Kendu Sendu Notice</b>',
    '',
    'Use of Kendu Sendu requires agreeing to the following terms.',
    '',
    '<b>Kendu Sendu is for small, recreational community tips only.</b>',
    '',
    'Kendu Sendu is custodial: deposited Kendu is held in a shared community wallet while individual balances and tips are tracked through an internal ledger. Sendu balances are not personal wallets or on-chain holdings until withdrawn.',
    '',
    `A linked wallet is not required to receive a Kendu Sendu. Linking a wallet is only required for depositing and withdrawing Base Kendu [<code>${KENDU_BASE_ADDRESS}</code>]`,
    '',
    'Deposits are credited only after verified Base transactions. Withdrawals and automatic safety-cap payouts require a linked wallet and are sent only to that verified address.',
    '',
    '<b>Individual allocations are limited to the lower of 10,000,000 Kendu or approximately $500 of Kendu using the current reference price. Available balances and pending tips both count toward this limit.</b>',
    '',
    'When a linked user reaches the applicable cap, Sendu may automatically reserve and withdraw their allocation to the linked wallet. An unlinked user at the cap cannot receive additional tips. The community wallet is also subject to an approximately $5,000 global custody ceiling, and deposits or new tips may be paused when limits or safety checks are unavailable.',
    '',
    'Direct manual transfers to the community wallet cannot be prevented. A verified deposit that reaches a safety limit may be credited and immediately queued for return or payout to the linked sending wallet. Network fees, price changes, outages, and confirmation delays may affect timing.',
    '',
    'Only deposit amounts you can afford to lose. Do not use Sendu for savings, investing, trading, payments, or storing significant value. Access may be interrupted by technical failures, account compromise, blockchain congestion, or service changes.',
    '',
    `Unclaimed tips may return to the sender after ${CLAIM_DAYS} days. Claimed balances that remain inactive for an extended period may become dormant and be handled under the published inactivity policy.`,
    '',
    'By using Kendu Sendu, you acknowledge its custodial risks, system limits, withdrawal rules, and experimental nature.',
  ].join('\n')
}

function agreementOptions() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'I Understand and Agree', callback_data: `sendu:terms:accept:${TERMS_VERSION}` }],
        [{ text: 'Cancel', callback_data: 'sendu:terms:cancel' }],
      ],
    },
  }
}

function publicAgreementResponse() {
  return {
    text: `<b>You must accept the Sendu terms before using Sendu.</b>\n\n${privateChatInstruction('review and accept the terms', '/sendu terms')}`,
  }
}

function privateChatInstruction(action, command) {
  return `<b>Complete this privately</b>\n\nFor privacy and security, ${action} in a private chat:\n1. Tap the Kendu Dashboard bot's name or profile image.\n2. Select <b>Message</b>.\n3. Send <code>${command}</code>.`
}

function parseWholeTokens(value) {
  const match = String(value || '').trim().replace(/,/g, '').match(/^(\d+(?:\.\d+)?)\s*([kmb]?)$/i)
  if (!match) return null
  const decimals = { '': 0, k: 3, m: 6, b: 9 }[match[2].toLowerCase()]
  const [whole, fraction = ''] = match[1].split('.')
  if (fraction.length > decimals) return null
  return BigInt(whole) * (10n ** BigInt(decimals)) + BigInt((fraction + '0'.repeat(decimals)).slice(0, decimals) || '0')
}

function usdMicros(value) {
  const decimal = Number(value)
  if (!Number.isFinite(decimal) || decimal <= 0) throw new Error('Invalid Sendu USD limit or price')
  return BigInt(Math.ceil(decimal * 1e12))
}

async function currentSenduLimits(sql) {
  const [status] = await sql`
    select worker_seen_at, checked_at, price_usd, wallet_balance_raw, liabilities_raw, gas_wei, healthy, error
    from sendu_system_status where id = true
  `
  const checkedAt = status?.checked_at ? new Date(status.checked_at).getTime() : 0
  const workerSeenAt = status?.worker_seen_at ? new Date(status.worker_seen_at).getTime() : 0
  const maxAge = SYSTEM_STATUS_MAX_AGE_SECONDS * 1000
  if (!status || !status.healthy || Date.now() - checkedAt > maxAge || Date.now() - workerSeenAt > maxAge) {
    throw new Error('Sendu deposits and new tips are temporarily paused while wallet safety checks are unavailable')
  }
  const priceScaled = usdMicros(status.price_usd)
  if (priceScaled <= 0n) throw new Error('Sendu deposits and new tips are temporarily paused because the Kendu price is unavailable')
  const usdUserCapRaw = (USER_USD_CAP_MICROS * TOKEN_SCALE) / priceScaled
  const userCapRaw = usdUserCapRaw < USER_TOKEN_CAP_RAW ? usdUserCapRaw : USER_TOKEN_CAP_RAW
  const globalCapRaw = (GLOBAL_USD_CAP_MICROS * TOKEN_SCALE) / priceScaled
  return {
    userCapRaw,
    globalCapRaw,
    walletBalanceRaw: BigInt(status.wallet_balance_raw || 0),
    liabilitiesRaw: BigInt(status.liabilities_raw || 0),
    priceUsd: String(status.price_usd),
  }
}

function formatTokens(amount) {
  return amount.toLocaleString('en-US')
}

function parseIdSet(value) {
  return new Set(String(value || '').split(',').map(id => id.trim()).filter(Boolean))
}

function positiveInteger(value, fallback) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]))
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex')
}
