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
  { command: 'price',     description: 'ETH price & Kendu market cap' },
  { command: 'mcap',      description: 'Kendu market cap' },
  { command: 'holders',   description: 'Holder count & chart' },
  { command: 'calc',      description: 'Calculate holdings value' },
  { command: 'gains',     description: 'Gains calculator' },
  { command: 'wen',       description: 'Wen?' },
  { command: 'dashboard', description: 'Open the dashboard' },
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
