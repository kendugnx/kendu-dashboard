import crypto from 'node:crypto'
import postgres from 'postgres'
import { createPublicClient, decodeEventLog, formatUnits, getAddress, http, isAddress, parseAbiItem, verifyMessage } from 'viem'
import { base } from 'viem/chains'

const CLAIM_DAYS = positiveInteger(process.env.TIPPING_CLAIM_DAYS, 30)
const MAX_TIP = parseWholeTokens(process.env.TIPPING_MAX_TIP || '1000000000')
const TERMS_VERSION = 3
const TOKEN_SCALE = 10n ** 18n
const WALLET_LINK_MINUTES = 15
const KENDU_BASE_ADDRESS = getAddress(process.env.SENDU_KENDU_BASE_ADDRESS || '0xef73611F98DA6E57e0776317957af61B59E09Ed7')
const COMMUNITY_WALLET_ADDRESS = getAddress(process.env.SENDU_COMMUNITY_WALLET_ADDRESS || '0x4BED272122494f89ef3DF52995C2C31CF5a2ef77')
const DEPOSIT_CONFIRMATIONS = positiveInteger(process.env.SENDU_DEPOSIT_CONFIRMATIONS, 5)
const TRANSFER_EVENT = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)')
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
  if (!action || ['terms', 'disclaimer', 'rules', 'help'].includes(action)) {
    return { text: termsText(), options: acceptedTerms ? {} : agreementOptions() }
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
      text: `<b>Unlink Sendu wallet?</b>\n<code>${escapeHtml(address)}</code>\n\nThis removes only the wallet association. Your allocated Sendu tip balance and ledger history will remain unchanged, but you will not be able to deposit or withdraw until a wallet is linked again.`,
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
    const txHash = String(rawText).trim().match(/^\/sendu(?:@\w+)?\s+deposit(?:\s+(0x[0-9a-f]{64}))?\s*$/i)?.[1]
    if (!txHash) return { text: depositInstructions() }
    if (!depositsEnabled()) return { text: `${depositInstructions()}\n\n<b>Deposit claiming is not enabled yet. Do not send funds until it is enabled.</b>` }
    const deposit = await claimLiveDeposit(sql, message.from.id, address, txHash)
    return { text: `<b>Deposit credited</b>\nAmount: <b>${formatLiveKendu(deposit.amountRaw)} Kendu</b>\nLive balance: <b>${formatLiveKendu(deposit.balanceRaw)} Kendu</b>\n\n<a href="https://basescan.org/tx/${deposit.txHash}">View transaction</a>` }
  }
  if (action !== 'link') {
    return { text: 'Use <code>/sendu terms</code>, <code>/sendu link</code>, <code>/sendu wallet</code>, <code>/sendu unlink</code>, or <code>/sendu deposit</code> in this private chat. Send tipping, balance, history, claim, and ledger commands in the community group.' }
  }
  if (!acceptedTerms) {
    return { text: `${termsText()}\n\n<b>You must agree before linking a wallet.</b>`, options: agreementOptions() }
  }

  const existing = await linkedWallet(sql, message.from.id)
  if (existing) {
    return { text: `<b>Sendu wallet already linked</b>\n<code>${escapeHtml(existing)}</code>\n\nUse <code>/sendu unlink</code> before linking a different wallet.` }
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
    text: `<b>Link your Sendu wallet</b>\n\nOpen this link in Safari or your normal browser. Telegram's built-in browser is not supported.\n\n<code>${escapeHtml(walletUrl)}</code>\n\nThis single-use link expires in ${WALLET_LINK_MINUTES} minutes.`,
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
      ? 'Wallet unlinked. Your allocated Sendu tip balance and ledger history were not changed. Deposits and withdrawals require a linked wallet.'
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
  if (/^(terms|disclaimer|rules)$/i.test(normalized)) {
    return { text: privateChatInstruction('review and accept the Sendu terms', '/sendu terms') }
  }
  if (/^help$/i.test(normalized) || !normalized) {
    return { text: acceptedTerms ? usageText() : publicAgreementResponse().text }
  }
  if (!acceptedTerms) return publicAgreementResponse()

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
      : result.amountRaw > 0n
        ? `<b>Claimed:</b> ${formatLiveKendu(result.amountRaw)} Kendu\n<b>Balance:</b> ${formatLiveKendu(result.balanceRaw)} Kendu`
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

  const lines = [
    `<b>Sendu!</b> ${displayName(message.from)} tipped ${displayName(recipient)} <b>${formatTokens(parsed.amount)} Kendu</b>.`,
    `<b>Sender balance:</b> ${formatLiveKendu(result.senderBalanceRaw)} Kendu`,
  ]
  if (result.pending) {
    lines.push('', `${displayName(recipient)} must use <code>/sendu claim</code> within ${CLAIM_DAYS} days or the tip returns to the sender.`)
  } else {
    lines.push(`<b>Recipient balance:</b> ${formatLiveKendu(result.recipientBalanceRaw)} Kendu`)
  }
  return { text: lines.join('\n') }
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
    await tx`create index if not exists sendu_wallet_link_requests_user_idx on sendu_wallet_link_requests (telegram_id, created_at desc)`
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

  return sql.begin(async tx => {
    const inserted = await tx`
      insert into sendu_deposits (tx_hash, telegram_id, from_address, amount_raw, block_number)
      values (${txHash}, ${telegramId}, ${expectedFrom.toLowerCase()}, ${amountRaw.toString()}::numeric, ${receipt.blockNumber.toString()}::bigint)
      on conflict do nothing
      returning tx_hash
    `
    if (!inserted.length) throw new Error('This deposit transaction has already been claimed')
    await tx`insert into sendu_live_accounts (telegram_id) values (${telegramId}) on conflict do nothing`
    const [account] = await tx`
      update sendu_live_accounts
      set balance_raw = balance_raw + ${amountRaw.toString()}::numeric, updated_at = now()
      where telegram_id = ${telegramId}
      returning balance_raw
    `
    await tx`
      insert into sendu_live_ledger (telegram_id, amount_raw, kind, reference_id)
      values (${telegramId}, ${amountRaw.toString()}::numeric, 'deposit', ${txHash})
    `
    return { txHash, amountRaw, balanceRaw: account.balance_raw }
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

function formatLiveKendu(rawAmount) {
  const [whole, fraction = ''] = formatUnits(BigInt(String(rawAmount)), 18).split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const trimmed = fraction.replace(/0+$/, '').slice(0, 6)
  return trimmed ? `${grouped}.${trimmed}` : grouped
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
  return sql.begin(async tx => {
    if (!await registerCommand(tx, key)) return { duplicate: true }
    const locked = await tx`select telegram_id, balance_raw from sendu_live_accounts where telegram_id in (${senderId}, ${recipientId}) order by telegram_id for update`
    const sender = locked.find(row => String(row.telegram_id) === String(senderId))
    const senderBalanceRaw = BigInt(sender?.balance_raw || 0)
    if (senderBalanceRaw < amountRaw) return { insufficient: true, balanceRaw: senderBalanceRaw }

    const recipientRows = await tx`select activated_at, terms_version from sendu_users where telegram_id = ${recipientId}`
    const pending = !recipientRows[0]?.activated_at || Number(recipientRows[0]?.terms_version || 0) < TERMS_VERSION
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
    return { pending, senderBalanceRaw: BigInt(senderRows[0].balance_raw), recipientBalanceRaw }
  })
}

async function claimPending(sql, telegramId, key) {
  return sql.begin(async tx => {
    if (!await registerCommand(tx, key)) return { duplicate: true }
    await tx`select telegram_id from sendu_live_accounts where telegram_id = ${telegramId} for update`
    const tips = await tx`select id, amount_raw from sendu_live_tips where recipient_id = ${telegramId} and status = 'pending' and expires_at > now() order by created_at for update`
    const amountRaw = tips.reduce((sum, tip) => sum + BigInt(tip.amount_raw), 0n)
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
    return { amountRaw, balanceRaw: BigInt(rows[0]?.balance_raw || 0) }
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
  return [
    '<b>Sendu Balance</b>',
    `Available: <b>${formatLiveKendu(account?.balance_raw || 0)} Kendu</b>`,
    `Pending to claim: <b>${formatLiveKendu(pending?.amount_raw || 0)} Kendu</b>`,
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
  const commands = [
    '<b>Sendu Commands</b>',
    '',
    '<b>Public community chat</b>',
    'Reply to someone: <code>/sendu 1000</code>',
    'Known user: <code>/sendu @user 1000</code>',
    'Claim pending tips: <code>/sendu claim</code>',
    'Balance: <code>/sendu balance</code>',
    'History: <code>/sendu history</code>',
    'Community ledger: <code>/sendu ledger</code>',
    '',
    '<b>Private chat with the bot only</b>',
    'Review terms: <code>/sendu terms</code>',
    'Link wallet: <code>/sendu link</code>',
    'Check linked wallet: <code>/sendu wallet</code>',
    'Unlink wallet: <code>/sendu unlink</code>',
    'Deposit Kendu: <code>/sendu deposit</code>',
  ].join('\n')
  return `${commands}\n\n${termsText()}`
}

function termsText() {
  return [
    '<b>Important Sendu Notice</b>',
    '',
    '<b>Sendu is for small, recreational community tips only.</b>',
    '',
    'Sendu is custodial: deposited Kendu is held in a shared community wallet while individual balances and tips are tracked through an internal ledger. Sendu balances are not personal wallets or on-chain holdings until withdrawn.',
    '',
    'Deposits are credited only after verified Base transactions. Withdrawals are not enabled yet and will require a linked wallet when launched.',
    '',
    'Only deposit amounts you can afford to lose. Do not use Sendu for savings, investing, trading, payments, or storing significant value. Access may be interrupted by technical failures, account compromise, blockchain congestion, or service changes.',
    '',
    `Unclaimed tips may return to the sender after ${CLAIM_DAYS} days. Claimed balances that remain inactive for an extended period may become dormant and be handled under the published inactivity policy.`,
    '',
    'By using live Sendu, you acknowledge its custodial risks, system limits, withdrawal rules, and experimental nature.',
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
