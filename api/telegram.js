// api/telegram.js — Telegram bot webhook handler
const TOKEN = process.env.TELEGRAM_BOT_TOKEN

const SUPPLY = 996.74e9

const TIERS = [
  { name: 'Seaweed',       min: 0,      max: 1e6   },
  { name: 'Plankton',      min: 1e6,    max: 5e6   },
  { name: 'Shrimp',        min: 5e6,    max: 10e6  },
  { name: 'Magikarp',      min: 10e6,   max: 20e6  },
  { name: 'Crab',          min: 20e6,   max: 35e6  },
  { name: 'Sardine',       min: 35e6,   max: 50e6  },
  { name: 'Stingray',      min: 50e6,   max: 75e6  },
  { name: 'Octopus',       min: 75e6,   max: 100e6 },
  { name: 'Dolphin',       min: 100e6,  max: 150e6 },
  { name: 'Barracuda',     min: 150e6,  max: 200e6 },
  { name: 'Shark',         min: 200e6,  max: 300e6 },
  { name: 'Orca',          min: 300e6,  max: 400e6 },
  { name: 'Swordfish',     min: 400e6,  max: 500e6 },
  { name: 'Whale',         min: 500e6,  max: 700e6 },
  { name: 'Leviathan',     min: 700e6,  max: 900e6 },
  { name: 'Kraken',        min: 900e6,  max: 1.2e9 },
  { name: 'Chadasaurus',   min: 1.2e9,  max: 1.6e9 },
  { name: 'Megalodon',     min: 1.6e9,  max: 2.3e9 },
  { name: 'Gyrados',       min: 2.3e9,  max: 3.5e9 },
  { name: 'Godwhale',      min: 3.5e9,  max: 4.5e9 },
  { name: 'Eternal',       min: 4.5e9,  max: Infinity },
]

function tierFor(tokens) {
  if (!isFinite(tokens) || tokens <= 0) return null
  return TIERS.find(t => tokens >= t.min && tokens < t.max) || TIERS[TIERS.length - 1]
}

function parseTokens(str) {
  if (!str) return null
  const m = str.toUpperCase().match(/^([\d.]+)\s*([KMBT]?)$/)
  if (!m) return null
  const n = parseFloat(m[1])
  const mult = { '': 1, 'K': 1e3, 'M': 1e6, 'B': 1e9, 'T': 1e12 }[m[2]] ?? 1
  return n * mult
}

function parseMC(str) {
  if (!str) return null
  const m = str.replace(/\$/g, '').toUpperCase().match(/^([\d.]+)\s*([KMBT]?)$/)
  if (!m) return null
  const n = parseFloat(m[1])
  const mult = { '': 1, 'K': 1e3, 'M': 1e6, 'B': 1e9, 'T': 1e12 }[m[2]] ?? 1
  return n * mult
}

async function sendMessage(chatId, text) {
  await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  })
}

async function getPrice() {
  const [ethRes, kenduRes] = await Promise.all([
    fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd&include_24hr_change=true', { cache: 'no-store' }),
    fetch('https://api.dexscreener.com/latest/dex/tokens/0xaa95f26e30001251fb905d264Aa7b00eE9dF6C18', { cache: 'no-store' }),
  ])
  const ethJson   = await ethRes.json()
  const kenduJson = await kenduRes.json()
  const pair = (kenduJson?.pairs || []).find(p => p.chainId === 'ethereum') || kenduJson?.pairs?.[0]
  return {
    ethPrice:   ethJson.ethereum?.usd,
    ethChange:  ethJson.ethereum?.usd_24h_change,
    kenduPrice: pair?.priceUsd ? Number(pair.priceUsd) : null,
    kenduChange: pair?.priceChange?.h24 ? Number(pair.priceChange.h24) : null,
  }
}

async function getHolders() {
  const r = await fetch('https://kendu-dashboard.com/api/treasury', { cache: 'no-store' })
  const j = await r.json()
  return j
}

async function getMCap() {
  const r = await fetch(
    'https://api.dexscreener.com/latest/dex/tokens/0xaa95f26e30001251fb905d264Aa7b00eE9dF6C18',
    { cache: 'no-store' }
  )
  const j = await r.json()
  const pair = (j?.pairs || []).find(p => p.chainId === 'ethereum') || j?.pairs?.[0]
  return pair?.marketCap
}

function fmt(n) {
  if (!isFinite(n)) return '—'
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K'
  return '$' + n.toFixed(2)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).send('OK')

  const { message } = req.body || {}
  if (!message?.text) return res.status(200).send('OK')

  const chatId = message.chat.id
  const text   = message.text.trim().toLowerCase()

  try {
    if (text.startsWith('/start') || text.startsWith('/help')) {
      await sendMessage(chatId,
        `<b>KENDU DASHBOARD BOT</b>\n\n` +
        `COMMANDS:\n` +
        `/price — ETH PRICE & KENDU MC\n` +
        `/mcap — KENDU MARKET CAP\n` +
        `/treasury — TREASURY & LP VALUES\n` +
        `/holders — HOLDER COUNTS\n` +
        `/calc — CALCULATE HOLDINGS VALUE\n` +
        `/dashboard — OPEN THE DASHBOARD`
      )

    } else if (text.startsWith('/price')) {
      const { ethPrice, ethChange, kenduChange } = await getPrice()
      const mc = await getMCap()
      const fmtChange = c => c == null ? '' : ` ${c > 0 ? '▲' : '▼'} ${Math.abs(c).toFixed(2)}% (24H)`
      const ethStr = ethPrice != null ? `$${ethPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'
      await sendMessage(chatId,
        `<b>ETH</b>  ${ethStr}${fmtChange(ethChange)}\n` +
        `<b>KENDU MC</b>  ${fmt(mc)}${fmtChange(kenduChange)}`
      )

    } else if (text.startsWith('/mcap')) {
      const { kenduChange } = await getPrice()
      const mc = await getMCap()
      const fmtChange = c => c == null ? '' : ` ${c > 0 ? '▲' : '▼'} ${Math.abs(c).toFixed(2)}% (24H)`
      await sendMessage(chatId, `<b>KENDU MARKET CAP</b>\n${fmt(mc)}${fmtChange(kenduChange)}`)

    } else if (text.startsWith('/treasury')) {
      const j = await getHolders()
      const lines = [`<b>TREASURY &amp; LIQUIDITY</b>`]
      if (j.treasury != null) lines.push(`TREASURY: ${fmt(j.treasury)}`)
      if (j.lpEth    != null) lines.push(`ETH LP: ${fmt(j.lpEth)}`)
      if (j.lpBase   != null) lines.push(`BASE LP: ${fmt(j.lpBase)}`)
      if (j.lpSol    != null) lines.push(`SOL LP: ${fmt(j.lpSol)}`)
      await sendMessage(chatId, lines.join('\n'))

    } else if (text.startsWith('/holders')) {
      await sendMessage(chatId,
        `<b>HOLDER COUNTS</b>\nVISIT THE DASHBOARD FOR LIVE HOLDER DATA:\nhttps://kendu-dashboard.com`
      )

    } else if (text.startsWith('/calc')) {
      const parts = text.split(/\s+/).slice(1)
      const input = parts[0]?.toLowerCase()
      const tierMatch = input ? TIERS.find(t =>
        t.name.toLowerCase() === input ||
        t.name.toLowerCase() === `kendu ${input}` ||
        `kendu ${t.name.toLowerCase()}` === input
      ) : null
      const tokens = tierMatch ? tierMatch.min : parseTokens(input)
      const targetMC = parseMC(parts[1])

      if (!tokens) {
        await sendMessage(chatId,
          `<b>USAGE:</b>\n/calc [HOLDING] — E.G. /calc 500M\n/calc [HOLDING] [TARGET MC] — E.G. /calc 500M 1B\n/calc [TIER] — E.G. /calc whale`
        )
      } else {
        const mc = await getMCap()
        const pricePerToken = mc / SUPPLY
        const currentValue = tokens * pricePerToken
        const currentTier  = tierFor(tokens)

        const lines = [
          `<b>HOLDING:</b> ${tokens >= 1e9 ? (tokens / 1e9).toFixed(2) + 'B' : (tokens / 1e6).toFixed(2) + 'M'} TOKENS`,
          `<b>CURRENT MC:</b> ${fmt(mc)}`,
          `<b>CURRENT VALUE:</b> ${fmt(currentValue)}`,
          `<b>TIER:</b> ${currentTier?.name?.toUpperCase() ?? '—'}`,
        ]

        if (targetMC) {
          const targetPrice = targetMC / SUPPLY
          const targetValue = tokens * targetPrice
          const multiplier  = targetValue / currentValue
          lines.push(``)
          lines.push(`<b>TARGET MC:</b> ${fmt(targetMC)}`)
          lines.push(`<b>VALUE @ TARGET:</b> ${fmt(targetValue)}`)
          lines.push(`<b>MULTIPLIER:</b> ${multiplier.toFixed(2)}X`)
        }

        await sendMessage(chatId, lines.join('\n'))
      }

    } else if (text.startsWith('/dashboard')) {
      await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: '<b>KENDU DASHBOARD</b>',
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[
              { text: '🚀 OPEN DASHBOARD', web_app: { url: 'https://kendu-dashboard.com' } }
            ]]
          }
        })
      })
    }
  } catch (e) {
    await sendMessage(chatId, 'ERROR FETCHING DATA. TRY AGAIN IN A MOMENT.')
  }

  res.status(200).send('OK')
}
