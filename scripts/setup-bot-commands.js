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
  { command: 'price',     description: 'ETH price + Kendu MC' },
  { command: 'mcap',      description: 'Kendu MC' },
  { command: 'hhi',       description: 'Current HHI index' },
  { command: 'gas',       description: 'Current ETH gas fees' },
  { command: 'wen',       description: 'X to MC' },
  { command: 'calc',      description: 'Holdings value calculator' },
  { command: 'gains',     description: 'Gains calculator' },
  { command: 'holders',   description: 'Holders chart' },
  { command: 'volume',    description: 'Volume chart' },
  { command: 'snapshot',  description: 'Generate 24h snapshot' },
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
