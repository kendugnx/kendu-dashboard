import crypto from 'node:crypto'
import postgres from 'postgres'

const CLAIM_DAYS = positiveInteger(process.env.TIPPING_CLAIM_DAYS, 30)
const MAX_TIP = parseWholeTokens(process.env.TIPPING_MAX_TIP || '1000000000')
const TERMS_VERSION = 1
const allowedChatIds = parseIdSet(process.env.TIPPING_TEST_CHAT_IDS)
const adminUserIds = parseIdSet(process.env.TIPPING_ADMIN_USER_IDS)

let sqlClient
let schemaReady

export function tippingEnabledForChat(chatId) {
  return /^(1|true|on|enabled)$/i.test(String(process.env.TIPPING_ENABLED || '')) &&
    allowedChatIds.has(String(chatId))
}

export function isTippingCommand(rawText) {
  return /^\/(?:sendu|tipbalance|tiphistory)(?:@\w+)?(?:\s|$)/i.test(String(rawText || ''))
}

export function isTippingCallback(data) {
  return /^sendu:terms:(?:accept:\d+|cancel)$/.test(String(data || ''))
}

export async function observeTippingUser(message) {
  if (!tippingEnabledForChat(message?.chat?.id) || !message?.from?.id) return
  const sql = await database()
  await upsertUser(sql, message.from)
}

export async function handleTippingCallback(callbackQuery) {
  const chatId = callbackQuery?.message?.chat?.id
  if (!tippingEnabledForChat(chatId)) return { text: 'Sendu is not enabled in this chat.', showAlert: true }
  if (!callbackQuery?.from?.id) return { text: 'Unable to identify your Telegram account.', showAlert: true }

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
  return { text: 'Sendu terms accepted. You can now use the sandbox commands.', showAlert: true }
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
    return { text: termsText(), options: acceptedTerms ? {} : agreementOptions() }
  }
  if (/^help$/i.test(normalized) || !normalized) {
    return { text: usageText(), options: acceptedTerms ? {} : agreementOptions() }
  }
  if (!acceptedTerms) return agreementResponse()

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
      : result.amount > 0n
        ? `<b>Claimed:</b> ${formatTokens(result.amount)} Kendu\n<b>Balance:</b> ${formatTokens(result.balance)} Kendu`
        : `You have no pending Sendu tips.\n<b>Balance:</b> ${formatTokens(result.balance)} Kendu` }
  }
  const fundMatch = normalized.match(/^fund(?:\s+(@[A-Za-z0-9_]+))?\s+([\d,.]+\s*[kmb]?)\s*(?:kendu)?$/i)
  if (fundMatch) {
    if (!adminUserIds.has(String(message.from.id))) return { text: 'Only a Sendu sandbox administrator can fund test buckets.' }
    const amount = parseWholeTokens(fundMatch[2])
    if (!amount || amount <= 0n) return { text: 'Enter a positive whole-Kendu amount.' }
    const target = fundMatch[1]
      ? await resolveTarget(sql, message, fundMatch[1])
      : (message.reply_to_message?.from || message.from)
    if (!target?.id) return { text: 'I could not identify that user. Reply to one of their messages instead.' }
    const result = await fundAccount(sql, target.id, amount, message.from.id, commandKey(message, 'fund'))
    return { text: result.duplicate
      ? 'This funding command was already processed.'
      : `<b>Sandbox funded:</b> ${displayName(target)}\n<b>Amount:</b> ${formatTokens(amount)} simulated Kendu\n<b>Balance:</b> ${formatTokens(result.balance)} Kendu` }
  }

  const parsed = parseSend(normalized, message)
  if (!parsed) return { text: usageText() }
  if (!parsed.amount || parsed.amount <= 0n) return { text: 'Enter a positive whole-Kendu amount.' }
  if (parsed.amount > MAX_TIP) return { text: `The sandbox maximum is ${formatTokens(MAX_TIP)} Kendu per tip.` }

  const recipient = await resolveTarget(sql, message, parsed.username)
  if (!recipient?.id) return { text: 'I do not know that user yet. Reply directly to one of their messages with <code>/sendu [amount]</code>.' }
  if (String(recipient.id) === String(message.from.id)) return { text: 'You cannot Sendu yourself.' }

  const result = await sendTip(sql, {
    senderId: message.from.id,
    recipientId: recipient.id,
    amount: parsed.amount,
    commandKey: commandKey(message, 'send'),
  })
  if (result.duplicate) return { text: 'This tip was already processed.' }
  if (result.insufficient) return { text: `Insufficient Sendu balance.\n<b>Available:</b> ${formatTokens(result.balance)} Kendu` }

  const lines = [
    `<b>Sendu!</b> ${displayName(message.from)} tipped ${displayName(recipient)} <b>${formatTokens(parsed.amount)} Kendu</b>.`,
    `<b>Sender balance:</b> ${formatTokens(result.senderBalance)} Kendu`,
  ]
  if (result.pending) {
    lines.push('', `${displayName(recipient)} must use <code>/sendu claim</code> within ${CLAIM_DAYS} days or the tip returns to the sender.`)
  } else {
    lines.push(`<b>Recipient balance:</b> ${formatTokens(result.recipientBalance)} Kendu`)
  }
  return { text: lines.join('\n') }
}

function databaseUrl() {
  return process.env.TIPPING_DATABASE_URL || process.env.DATABASE_URL || ''
}

async function database() {
  const url = databaseUrl()
  if (!url) throw new Error('Sendu sandbox database is not configured')
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
      create table if not exists sendu_accounts (
        telegram_id bigint primary key references sendu_users(telegram_id),
        balance bigint not null default 0 check (balance >= 0),
        updated_at timestamptz not null default now()
      )
    `
    await tx`
      create table if not exists sendu_tips (
        id uuid primary key,
        sender_id bigint not null references sendu_users(telegram_id),
        recipient_id bigint not null references sendu_users(telegram_id),
        amount bigint not null check (amount > 0),
        status text not null check (status in ('pending', 'claimed', 'expired')),
        expires_at timestamptz,
        claimed_at timestamptz,
        created_at timestamptz not null default now()
      )
    `
    await tx`create index if not exists sendu_tips_recipient_status_idx on sendu_tips (recipient_id, status, created_at)`
    await tx`
      create table if not exists sendu_ledger (
        id bigserial primary key,
        telegram_id bigint not null references sendu_users(telegram_id),
        amount bigint not null check (amount <> 0),
        kind text not null,
        reference_id text not null,
        created_at timestamptz not null default now()
      )
    `
    await tx`create index if not exists sendu_ledger_user_created_idx on sendu_ledger (telegram_id, created_at desc)`
    await tx`
      create table if not exists sendu_commands (
        command_key text primary key,
        created_at timestamptz not null default now()
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
    await tx`insert into sendu_accounts (telegram_id) values (${from.id}) on conflict do nothing`
  })
}

async function hasAcceptedTerms(sql, telegramId) {
  const rows = await sql`select terms_version from sendu_users where telegram_id = ${telegramId}`
  return Number(rows[0]?.terms_version || 0) >= TERMS_VERSION
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
  const rows = await tx`insert into sendu_commands (command_key) values (${key}) on conflict do nothing returning command_key`
  return rows.length > 0
}

async function fundAccount(sql, telegramId, amount, adminId, key) {
  return sql.begin(async tx => {
    if (!await registerCommand(tx, key)) return { duplicate: true }
    await tx`select telegram_id from sendu_accounts where telegram_id = ${telegramId} for update`
    const rows = await tx`update sendu_accounts set balance = balance + ${amount}, updated_at = now() where telegram_id = ${telegramId} returning balance`
    await tx`insert into sendu_ledger (telegram_id, amount, kind, reference_id) values (${telegramId}, ${amount}, 'sandbox_fund', ${String(adminId)})`
    return { balance: BigInt(rows[0].balance) }
  })
}

async function sendTip(sql, { senderId, recipientId, amount, commandKey: key }) {
  return sql.begin(async tx => {
    if (!await registerCommand(tx, key)) return { duplicate: true }
    const locked = await tx`select telegram_id, balance from sendu_accounts where telegram_id in (${senderId}, ${recipientId}) order by telegram_id for update`
    const sender = locked.find(row => String(row.telegram_id) === String(senderId))
    const senderBalance = BigInt(sender?.balance || 0)
    if (senderBalance < amount) return { insufficient: true, balance: senderBalance }

    const recipientRows = await tx`select activated_at, terms_version from sendu_users where telegram_id = ${recipientId}`
    const pending = !recipientRows[0]?.activated_at || Number(recipientRows[0]?.terms_version || 0) < TERMS_VERSION
    const tipId = crypto.randomUUID()
    const senderRows = await tx`update sendu_accounts set balance = balance - ${amount}, updated_at = now() where telegram_id = ${senderId} returning balance`
    await tx`insert into sendu_ledger (telegram_id, amount, kind, reference_id) values (${senderId}, ${-amount}, 'tip_sent', ${tipId})`

    let recipientBalance = null
    if (pending) {
      await tx`
        insert into sendu_tips (id, sender_id, recipient_id, amount, status, expires_at)
        values (${tipId}, ${senderId}, ${recipientId}, ${amount}, 'pending', now() + (${CLAIM_DAYS} * interval '1 day'))
      `
    } else {
      await tx`
        insert into sendu_tips (id, sender_id, recipient_id, amount, status, claimed_at)
        values (${tipId}, ${senderId}, ${recipientId}, ${amount}, 'claimed', now())
      `
      const recipientAccount = await tx`update sendu_accounts set balance = balance + ${amount}, updated_at = now() where telegram_id = ${recipientId} returning balance`
      recipientBalance = BigInt(recipientAccount[0].balance)
      await tx`insert into sendu_ledger (telegram_id, amount, kind, reference_id) values (${recipientId}, ${amount}, 'tip_received', ${tipId})`
    }
    return { pending, senderBalance: BigInt(senderRows[0].balance), recipientBalance }
  })
}

async function claimPending(sql, telegramId, key) {
  return sql.begin(async tx => {
    if (!await registerCommand(tx, key)) return { duplicate: true }
    await tx`select telegram_id from sendu_accounts where telegram_id = ${telegramId} for update`
    const tips = await tx`select id, amount from sendu_tips where recipient_id = ${telegramId} and status = 'pending' and expires_at > now() order by created_at for update`
    const amount = tips.reduce((sum, tip) => sum + BigInt(tip.amount), 0n)
    await tx`update sendu_users set activated_at = coalesce(activated_at, now()), updated_at = now() where telegram_id = ${telegramId}`
    if (amount > 0n) {
      const ids = tips.map(tip => tip.id)
      await tx`update sendu_tips set status = 'claimed', claimed_at = now() where id in ${tx(ids)}`
      await tx`update sendu_accounts set balance = balance + ${amount}, updated_at = now() where telegram_id = ${telegramId}`
      for (const tip of tips) {
        await tx`insert into sendu_ledger (telegram_id, amount, kind, reference_id) values (${telegramId}, ${tip.amount}, 'tip_received', ${tip.id})`
      }
    }
    const rows = await tx`select balance from sendu_accounts where telegram_id = ${telegramId}`
    return { amount, balance: BigInt(rows[0]?.balance || 0) }
  })
}

async function expirePendingTips(sql) {
  await sql.begin(async tx => {
    const expired = await tx`select id, sender_id, amount from sendu_tips where status = 'pending' and expires_at <= now() order by sender_id for update skip locked`
    for (const tip of expired) {
      await tx`update sendu_tips set status = 'expired' where id = ${tip.id} and status = 'pending'`
      await tx`update sendu_accounts set balance = balance + ${tip.amount}, updated_at = now() where telegram_id = ${tip.sender_id}`
      await tx`insert into sendu_ledger (telegram_id, amount, kind, reference_id) values (${tip.sender_id}, ${tip.amount}, 'tip_returned', ${tip.id})`
    }
  })
}

async function balanceText(sql, telegramId) {
  const [account] = await sql`select balance from sendu_accounts where telegram_id = ${telegramId}`
  const [pending] = await sql`select coalesce(sum(amount), 0) as amount from sendu_tips where recipient_id = ${telegramId} and status = 'pending' and expires_at > now()`
  return [
    '<b>Sendu Sandbox Balance</b>',
    `Available: <b>${formatTokens(BigInt(account?.balance || 0))} Kendu</b>`,
    `Pending to claim: <b>${formatTokens(BigInt(pending?.amount || 0))} Kendu</b>`,
    '',
    '<i>Simulated Kendu only. Deposits and withdrawals are not enabled.</i>',
  ].join('\n')
}

async function historyText(sql, telegramId) {
  const rows = await sql`
    select t.amount, t.status, t.created_at, t.sender_id, t.recipient_id,
      sender.display_name as sender_name, sender.username as sender_username,
      recipient.display_name as recipient_name, recipient.username as recipient_username
    from sendu_tips t
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
    return `${sent ? 'Sent to' : 'Received from'} ${other}: <b>${formatTokens(BigInt(row.amount))} Kendu</b>${status}`
  })
  return `<b>Recent Sendu Tips</b>\n${lines.join('\n')}`
}

async function ledgerText(sql, requestedPage) {
  const pageSize = 10
  const [{ count }] = await sql`select count(*)::int as count from sendu_tips`
  const total = Number(count || 0)
  if (!total) return 'The Sendu ledger has no transactions yet.'

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(requestedPage, totalPages)
  const offset = (page - 1) * pageSize
  const rows = await sql`
    select t.amount, t.status, t.created_at,
      sender.display_name as sender_name, sender.username as sender_username,
      recipient.display_name as recipient_name, recipient.username as recipient_username
    from sendu_tips t
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
      `${formatTokens(BigInt(row.amount))} Kendu · ${status} · ${formatLedgerTime(row.created_at)}`,
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
    '<b>Sendu Sandbox</b>',
    'Reply to someone: <code>/sendu 1000</code>',
    'Known user: <code>/sendu @user 1000</code>',
    'Claim pending tips: <code>/sendu claim</code>',
    'Balance: <code>/sendu balance</code>',
    'History: <code>/sendu history</code>',
    'Community ledger: <code>/sendu ledger</code>',
  ].join('\n')
  return `${commands}\n\n${termsText()}`
}

function termsText() {
  return [
    '<b>Important Sendu Notice</b>',
    '',
    '<b>Sendu is for small, recreational community tips only.</b>',
    '',
    'The current sandbox uses simulated Kendu. Deposits and withdrawals are not enabled.',
    '',
    'The planned live version is custodial: deposited Kendu will be held in a shared bot-controlled wallet while individual balances and tips are tracked through an internal ledger. Sendu balances are not personal wallets or on-chain holdings until withdrawn.',
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

function agreementResponse() {
  return {
    text: `${termsText()}\n\n<b>You must agree before using Sendu.</b>`,
    options: agreementOptions(),
  }
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
