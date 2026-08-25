// One-time setup: registers the "/" command menu shown by Telegram clients.
// Run with: TELEGRAM_BOT_TOKEN=xxxx node scripts/setup-bot-commands.js
// Re-run any time the command list changes -- Telegram caches it client-side
// until setMyCommands is called again, it does not pick up new commands
// automatically just because the webhook handler supports them.

const TOKEN = process.env.TELEGRAM_BOT_TOKEN
if (!TOKEN) {
  console.error('Missing TELEGRAM_BOT_TOKEN env var')
  process.exit(1)
}

const commands = [
  { command: 'price',     description: 'ETH PRICE + KENDU MC' },
  { command: 'mcap',      description: 'KENDU MC' },
  { command: 'hhi',       description: 'CURRENT HHI INDEX' },
  { command: 'gas',       description: 'CURRENT ETH GAS FEES' },
  { command: 'wen',       description: 'X TO MC' },
  { command: 'calc',      description: 'HOLDINGS VALUE CALCULATOR' },
  { command: 'gains',     description: 'GAINS CALCULATOR' },
  { command: 'holders',   description: 'HOLDERS CHART' },
  { command: 'volume',    description: 'VOLUME CHART' },
  { command: 'snapshot',  description: 'GENERATE 24H SNAPSHOT' },
  { command: 'buys',      description: 'LATEST BUYS BY CHAIN' },
  { command: 'test',      description: 'TEST BOT RESPONSE' },
  { command: 'gnx',       description: 'MEH' },
  { command: 'gmx',       description: 'LORNIKO' },
  { command: 'emojiid',   description: 'SHOW CUSTOM EMOJI IDS' },
  { command: 'remind',    description: 'SET, LIST, OR CANCEL REMINDERS' },
  { command: 'dashboard', description: 'OPEN THE DASHBOARD' },
  { command: 'help',      description: 'List all commands' },
]

const res = await fetch(`https://api.telegram.org/bot${TOKEN}/setMyCommands`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ commands }),
})
const json = await res.json()
if (!json.ok) {
  console.error('setMyCommands failed:', json)
  process.exit(1)
}
console.log(`Registered ${commands.length} commands.`)
