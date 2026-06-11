// api/telegram.js — Telegram bot webhook handler
const TOKEN = process.env.TELEGRAM_BOT_TOKEN

const SUPPLY = 996.74e9

const HOLDERS_CSV = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTD6EM3vr9AZzq8WDqFpxLEQOxqEBc-w89053lNBDed4AUcxKfeVl1lSPiK9bUJFkPN1Y3X-tVXrGnG/pub?gid=584295169&single=true&output=csv'

const TIERS = [
  { name: 'Seaweed',     min: 0,      max: 1e6   },
  { name: 'Plankton',    min: 1e6,    max: 5e6   },
  { name: 'Shrimp',      min: 5e6,    max: 10e6  },
  { name: 'Magikarp',    min: 10e6,   max: 20e6  },
  { name: 'Crab',        min: 20e6,   max: 35e6  },
  { name: 'Sardine',     min: 35e6,   max: 50e6  },
  { name: 'Stingray',    min: 50e6,   max: 75e6  },
  { name: 'Octopus',     min: 75e6,   max: 100e6 },
  { name: 'Dolphin',     min: 100e6,  max: 150e6 },
  { name: 'Barracuda',   min: 150e6,  max: 200e6 },
  { name: 'Shark',       min: 200e6,  max: 300e6 },
  { name: 'Orca',        min: 300e6,  max: 400e6 },
  { name: 'Swordfish',   min: 400e6,  max: 500e6 },
  { name: 'Whale',       min: 500e6,  max: 700e6 },
  { name: 'Leviathan',   min: 700e6,  max: 900e6 },
  { name: 'Kraken',      min: 900e6,  max: 1.2e9 },
  { name: 'Chadasaurus', min: 1.2e9,  max: 1.6e9 },
  { name: 'Megalodon',   min: 1.6e9,  max: 2.3e9 },
  { name: 'Gyrados',     min: 2.3e9,  max: 3.5e9 },
  { name: 'Godwhale',    min: 3.5e9,  max: 4.5e9 },
  { name: 'Eternal',     min: 4.5e9,  max: Infinity },
]

function tierFor(tokens) {
  if (!isFinite(tokens) || tokens <= 0) return null
  return TIERS.find(t => tokens >= t.min && tokens < t.max) || TIERS[TIERS.length - 1]
}

function parseTokens(str) {
  if (!str) return null
  const m = str.toUpperCase().match(/^([\d.]+)\s*([KMBT]?)$/)
  if (!m) return null
  const mult = { '': 1, 'K': 1e3, 'M': 1e6, 'B': 1e9, 'T': 1e12 }[m[2]] ?? 1
  return parseFloat(m[1]) * mult
}

function parseMC(str) {
  if (!str) return null
  const m = str.replace(/\$/g, '').toUpperCase().match(/^([\d.]+)\s*([KMBT]?)$/)
  if (!m) return null
  const mult = { '': 1, 'K': 1e3, 'M': 1e6, 'B': 1e9, 'T': 1e12 }[m[2]] ?? 1
  return parseFloat(m[1]) * mult
}

function fmt(n) {
  if (!isFinite(n)) return '—'
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K'
  return '$' + n.toFixed(2)
}

async function sendMessage(chatId, text) {
  await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  })
}

async function sendPhoto(chatId, imageUrl, caption) {
  await fetch(`https://api.telegram.org/bot${TOKEN}/sendPhoto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, photo: imageUrl, caption, parse_mode: 'HTML' }),
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
    ethPrice:    ethJson.ethereum?.usd,
    ethChange:   ethJson.ethereum?.usd_24h_change,
    kenduChange: pair?.priceChange?.h24 ? Number(pair.priceChange.h24) : null,
  }
}

async function getMCap() {
  const r = await fetch('https://api.dexscreener.com/latest/dex/tokens/0xaa95f26e30001251fb905d264Aa7b00eE9dF6C18', { cache: 'no-store' })
  const j = await r.json()
  const pair = (j?.pairs || []).find(p => p.chainId === 'ethereum') || j?.pairs?.[0]
  return pair?.marketCap
}

async function fetchHoldersCSV() {
  const r = await fetch(HOLDERS_CSV, { cache: 'no-store' })
  const text = await r.text()
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return []
  const header = lines[0].split(',').map(s => s.trim().toLowerCase().replace(/[^a-z0-9]/g, ''))
  const dateIdx  = header.findIndex(h => /^date$|^day$/.test(h))
  const ethIdx   = header.findIndex(h => /eth/.test(h))
  const baseIdx  = header.findIndex(h => /base/.test(h))
  const solIdx   = header.findIndex(h => /sol/.test(h))
  const totalIdx = header.findIndex(h => /total/.test(h))
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(s => s.trim())
    const dstr = cols[dateIdx]
    if (!dstr) continue
    const [y, m, d] = dstr.split('-').map(Number)
    const date = new Date(y, m - 1, d)
    if (!isFinite(date.getTime())) continue
    const num = idx => idx >= 0 ? Number(cols[idx]?.replace(/[^\d.\-]/g, '')) : NaN
    const eth   = num(ethIdx)
    const base  = num(baseIdx)
    const sol   = num(solIdx)
    const total = isFinite(num(totalIdx)) ? num(totalIdx) : [eth, base, sol].filter(isFinite).reduce((a, b) => a + b, 0)
    if (!isFinite(total) || total <= 0) continue
    rows.push({ date, total, eth, base, sol })
  }
  return rows.sort((a, b) => a.date - b.date)
}

function buildChartUrl(rows, days = null, rangeLabel = 'ALL TIME') {
  const cutoff  = days ? Date.now() - days * 86400000 : null
  const filtered = cutoff ? rows.filter(r => r.date.getTime() >= cutoff) : rows
  const step    = Math.max(1, Math.floor(filtered.length / 40))
  const sampled = filtered.filter((_, i) => i % step === 0 || i === filtered.length - 1)

  const labels = sampled.map(r => r.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))
  const data   = sampled.map(r => r.total)

  const config = {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: rangeLabel,
        data,
        borderColor: '#F05C4E',
        backgroundColor: 'rgba(240,92,78,0.15)',
        borderWidth: 2.5,
        pointRadius: 0,
        fill: true,
        tension: 0.3,
      }]
    },
    options: {
      plugins: {
        legend: { display: false },
        title: {
          display: true,
          text: rangeLabel,
          color: '#F05C4E',
          font: { size: 13, weight: 'bold' },
        },
      },
      scales: {
        x: {
          ticks: { color: '#cccccc', maxTicksLimit: 5, maxRotation: 0, font: { size: 11 } },
          grid:  { color: 'rgba(255,255,255,0.08)' },
        },
        y: {
          ticks: { color: '#cccccc', font: { size: 11 } },
          grid:  { color: 'rgba(255,255,255,0.08)' },
        }
      },
      layout: { padding: { top: 10, bottom: 10, left: 10, right: 10 } },
    }
  }

  const encoded = encodeURIComponent(JSON.stringify(config))
  return `https://quickchart.io/chart?c=${encoded}&w=600&h=320&bkg=%23201E1F`
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
        `/holders — HOLDER COUNT & CHART\n` +
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

    } else if (text.startsWith('/holders')) {
      const parts = text.split(/\s+/).slice(1)
      const RANGE_MAP = { '1y': [365, '1Y'], '6m': [182, '6M'], '1m': [30, '1M'], '1w': [7, '1W'], '7d': [7, '1W'], '3d': [3, '3D'] }
      const [rangeDays, rangeLabel] = RANGE_MAP[parts[0]] ?? [null, 'ALL TIME']

      const rows = await fetchHoldersCSV()
      if (!rows.length) { await sendMessage(chatId, 'ERROR LOADING HOLDER DATA.'); return res.status(200).send('OK') }

      const latest = rows[rows.length - 1]
      const cutoff = rangeDays ? Date.now() - rangeDays * 86400000 : null
      const rangeRows = cutoff ? rows.filter(r => r.date.getTime() >= cutoff) : rows
      const first = rangeRows[0] ?? rows[0]

      const dTotal = latest.total - first.total
      const dEth   = isFinite(latest.eth)  && isFinite(first.eth)  ? latest.eth  - first.eth  : null
      const dBase  = isFinite(latest.base) && isFinite(first.base) ? latest.base - first.base : null
      const dSol   = isFinite(latest.sol)  && isFinite(first.sol)  ? latest.sol  - first.sol  : null

      const sign = n => n >= 0 ? `+${n.toLocaleString()}` : n.toLocaleString()

      const deltaLine = rangeDays == null ? '' :
        `\nΔ ${rangeLabel}: ${sign(dTotal)}` +
        (dEth  != null ? `  ETH ${sign(dEth)}`  : '') +
        (dBase != null && dBase !== 0 ? `  BASE ${sign(dBase)}` : '') +
        (dSol  != null && dSol  !== 0 ? `  SOL ${sign(dSol)}`  : '')

      const caption =
        `<b>TOTAL HOLDERS: ${latest.total.toLocaleString()}</b>\n` +
        `ETH: ${isFinite(latest.eth) ? latest.eth.toLocaleString() : '—'}  ` +
        `BASE: ${isFinite(latest.base) && latest.base > 0 ? latest.base.toLocaleString() : '—'}  ` +
        `SOL: ${isFinite(latest.sol) && latest.sol > 0 ? latest.sol.toLocaleString() : '—'}` +
        deltaLine

      const chartUrl = buildChartUrl(rows, rangeDays, rangeLabel)
      await sendPhoto(chatId, chartUrl, caption)

    } else if (text.startsWith('/calc')) {
      const parts = text.split(/\s+/).slice(1)
      const input = parts[0]?.toLowerCase()
      const tierMatch = input ? TIERS.find(t =>
        t.name.toLowerCase() === input ||
        t.name.toLowerCase() === `kendu ${input}` ||
        `kendu ${t.name.toLowerCase()}` === input
      ) : null
      const tokens   = tierMatch ? tierMatch.min : parseTokens(input)
      const targetMC = parseMC(parts[1])

      if (!tokens) {
        await sendMessage(chatId,
          `<b>USAGE:</b>\n/calc [HOLDING] — E.G. /calc 500M\n/calc [HOLDING] [TARGET MC] — E.G. /calc 500M 1B\n/calc [TIER] — E.G. /calc whale`
        )
      } else {
        const mc = await getMCap()
        const pricePerToken = mc / SUPPLY
        const currentValue  = tokens * pricePerToken
        const currentTier   = tierFor(tokens)

        const lines = [
          `<b>HOLDING:</b> ${tokens >= 1e9 ? (tokens / 1e9).toFixed(2) + 'B' : (tokens / 1e6).toFixed(2) + 'M'} TOKENS`,
          `<b>CURRENT MC:</b> ${fmt(mc)}`,
          `<b>CURRENT VALUE:</b> ${fmt(currentValue)}`,
          `<b>TIER:</b> ${currentTier?.name?.toUpperCase() ?? '—'}`,
        ]

        if (targetMC) {
          const targetValue = tokens * (targetMC / SUPPLY)
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
