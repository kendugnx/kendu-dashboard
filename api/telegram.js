// api/telegram.js — Telegram bot webhook handler
const TOKEN = process.env.TELEGRAM_BOT_TOKEN

const SUPPLY = 996.74e9
const KENDU_ETH_CA  = '0xaa95f26e30001251fb905d264Aa7b00eE9dF6C18'
const LP_ETH        = '0xd9f2a7471d1998c69de5cae6df5d3f070f01df9f'
const LP_BASE       = '0xFBFD0e1838A101a26FDB5D4ae0B4D17153eCA66B'
const LP_SOL        = 'B34Pu6w8eecYRXLEDxBCPy5JoFLy3iycLAPJpYiwbKMK'
const ARB_EFF       = 0.6
const ETHERSCAN_KEY = process.env.ETHERSCAN_API_KEY || 'M5XZ6NDDYYQ5HY9KVUQDJ12ME484DVEP4A'

// Curated CEX hot wallets excluded from HHI (EOAs, can't be detected on-chain) --
// mirrors src/utils/constants.js EXCHANGE_WALLETS.
const HHI_EXCLUDED = [
  '0x22f83e4b9cB95CB99B88E8f4f15ea598C74c2788'.toLowerCase(),
  '0x6D0D19bddDC5ED1dD501430c9621DD37ebd9062d'.toLowerCase(),
]

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
  if (n >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T'
  if (n >= 1e9)  return '$' + (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e6)  return '$' + (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e3)  return '$' + (n / 1e3).toFixed(1) + 'K'
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

async function getGas() {
  const params = new URLSearchParams({ chainid: '1', module: 'gastracker', action: 'gasoracle', apikey: ETHERSCAN_KEY })
  const r = await fetch(`https://api.etherscan.io/v2/api?${params}`, { cache: 'no-store' })
  const j = await r.json()
  if (j.status !== '1') throw new Error(j.message || 'Gas API error')
  const d = j.result
  return {
    fast:     Number(d.FastGasPrice),
    standard: Number(d.ProposeGasPrice),
    eco:      Number(d.SafeGasPrice),
  }
}

// Batched eth_getCode + token0() probe -- mirrors api/holders.js, used to exclude
// LPs/routers/bridges from HHI without a manual address list.
async function getOnchainFlags(addresses) {
  try {
    const batch = []
    addresses.forEach((addr, i) => {
      batch.push({ jsonrpc: '2.0', id: `code${i}`, method: 'eth_getCode', params: [addr, 'latest'] })
    })
    const r = await fetch('https://ethereum.publicnode.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batch),
      signal: AbortSignal.timeout(5000),
    })
    if (!r.ok) return addresses.map(() => false)
    const results = await r.json()
    const byId = new Map(results.map(item => [item.id, item.result]))
    return addresses.map((_, i) => {
      const code = byId.get(`code${i}`)
      return typeof code === 'string' && code !== '0x'
    })
  } catch {
    return addresses.map(() => false)
  }
}

async function getHHI() {
  const apiKey = process.env.ETHPLORER_API_KEY || 'freekey'
  const r = await fetch(`https://api.ethplorer.io/getTopTokenHolders/${KENDU_ETH_CA}?apiKey=${apiKey}&limit=100`, { cache: 'no-store' })
  const j = await r.json()
  if (!j.holders) throw new Error(j.error?.message || 'No holders data')
  const isContract = await getOnchainFlags(j.holders.map(h => h.address))
  const excludeSet = new Set(HHI_EXCLUDED)
  const filtered = j.holders.filter((h, i) => !isContract[i] && !excludeSet.has(h.address.toLowerCase()))
  const sum = filtered.reduce((acc, h) => {
    const share = Number(h.share)
    return isFinite(share) ? acc + share * share : acc
  }, 0)
  return Math.round(sum * 100) / 100
}

function hhiLabel(hhi) {
  if (hhi == null || !isFinite(hhi)) return '—'
  if (hhi < 1500) return 'Low'
  if (hhi < 2500) return 'Moderate'
  return 'High'
}

async function getImpactData() {
  const DEX = 'https://api.dexscreener.com/latest/dex/pairs'
  const [ethRes, baseRes, solRes, onChainRes] = await Promise.allSettled([
    fetch(`${DEX}/ethereum/${LP_ETH}`, { cache: 'no-store' }),
    fetch(`${DEX}/base/${LP_BASE}`,    { cache: 'no-store' }),
    fetch(`${DEX}/solana/${LP_SOL}`,   { cache: 'no-store' }),
    fetch(`https://kendu-dashboard.com/api/reserves?pool=${LP_ETH}`, { cache: 'no-store' }),
  ])
  const parsePair = res => {
    if (res.status !== 'fulfilled') return {}
    return res.value.json().then(j => {
      const pair = j?.pairs?.[0] || j?.pair
      return { liq: Number(pair?.liquidity?.usd || 0), mc: Number(pair?.marketCap || 0) }
    }).catch(() => ({}))
  }
  const [eth, base, sol] = await Promise.all([parsePair(ethRes), parsePair(baseRes), parsePair(solRes)])
  let ethLiq = eth.liq || 0
  if (onChainRes.status === 'fulfilled') {
    const j = await onChainRes.value.json().catch(() => ({}))
    if (j.liquidityUSD > 0) ethLiq = j.liquidityUSD
  }
  const currentMC = eth.mc || base.mc || sol.mc || null
  const liquidity = { eth: ethLiq || null, base: base.liq || null, sol: sol.liq || null }
  const effLiq = (liquidity.eth || 0) + ((liquidity.base || 0) + (liquidity.sol || 0)) * ARB_EFF
  return { currentMC, liquidity, effLiq }
}

function impactCalcMC(currentMC, effLiq, tradeUSD) {
  const q    = effLiq / 2
  const mult = Math.pow((q + tradeUSD) / q, 2)
  return { newMC: currentMC * mult, pctChange: (mult - 1) * 100 }
}

function impactTokens(chainLiq, price, tradeUSD) {
  if (!chainLiq || !price || !tradeUSD) return null
  const q  = chainLiq / 2
  const x0 = q / price
  return x0 - (x0 * q) / (q + tradeUSD)
}

function impactRequiredBuy(currentMC, effLiq, targetMC) {
  if (targetMC <= currentMC || !effLiq) return null
  return (effLiq / 2) * (Math.sqrt(targetMC / currentMC) - 1)
}

async function getVolume24h() {
  const r = await fetch(`https://api.geckoterminal.com/api/v2/networks/eth/pools/${LP_ETH}`, { headers: { Accept: 'application/json' }, cache: 'no-store' })
  if (!r.ok) return 0
  const j = await r.json()
  return Number(j?.data?.attributes?.volume_usd?.h24 ?? 0)
}

async function getVolumeCandles(days) {
  const r = await fetch(`https://api.geckoterminal.com/api/v2/networks/eth/pools/${LP_ETH}/ohlcv/day?limit=${days}&currency=usd`, { headers: { Accept: 'application/json' }, cache: 'no-store' })
  const j = await r.json()
  const ohlcv = j?.data?.attributes?.ohlcv_list || []
  return [...ohlcv]
    .sort((a, b) => a[0] - b[0])
    .map(([ts, , , , close, vol]) => ({ date: new Date(ts * 1000), vol: Number(vol), mc: Number(close) * SUPPLY }))
}

// Nearest-date lookup used to overlay an MC line onto charts whose own data
// points (CSV holder snapshots) don't share exact dates with the OHLCV-derived
// MC series. Returns null (gap, chart skips it via spanGaps) past maxDiffDays.
function nearestMc(series, targetDate, maxDiffDays = 2) {
  let best = null, bestDiff = Infinity
  for (const pt of series) {
    const diff = Math.abs(pt.date - targetDate)
    if (diff < bestDiff) { bestDiff = diff; best = pt }
  }
  return best && bestDiff <= maxDiffDays * 86400000 ? best.mc : null
}

async function buildVolumeChartUrl(candles, rangeLabel, opts = {}) {
  const title   = `Kendu Volume - ${rangeLabel}`
  const step    = Math.max(1, Math.floor(candles.length / 40))
  const sampled = candles.filter((_, i) => i % step === 0 || i === candles.length - 1)
  const labels  = sampled.map(c => c.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))
  const data    = sampled.map(c => c.vol)

  const datasets = [{ label: 'Volume', data, backgroundColor: 'rgba(255,107,74,0.7)', yAxisID: 'y' }]
  const yAxes = [{ id: 'y', position: 'left', ticks: { fontColor: '#ffffff', fontSize: 11 }, gridLines: { color: 'rgba(255,255,255,0.15)' } }]

  if (opts.overlayMc) {
    datasets.push({
      type: 'line',
      label: 'Market Cap ($M)',
      data: sampled.map(c => c.mc / 1e6),
      borderColor: '#5AC8FA',
      backgroundColor: 'rgba(90,200,250,0.15)',
      borderWidth: 2,
      pointRadius: 0,
      fill: false,
      lineTension: 0.3,
      yAxisID: 'y2',
    })
    yAxes.push({ id: 'y2', position: 'right', scaleLabel: { display: true, labelString: 'MC ($M)', fontColor: '#5AC8FA' }, ticks: { fontColor: '#5AC8FA', fontSize: 11 }, gridLines: { display: false } })
  }

  const config = {
    type: 'bar',
    data: { labels, datasets },
    options: {
      legend: { display: !!opts.overlayMc, labels: { fontColor: '#ffffff' } },
      title: { display: true, text: title, fontColor: '#FF6B4A', fontSize: 14, fontStyle: 'bold' },
      scales: {
        xAxes: [{ ticks: { fontColor: '#ffffff', maxTicksLimit: 5, maxRotation: 0, fontSize: 11 }, gridLines: { color: 'rgba(255,255,255,0.15)' } }],
        yAxes,
      },
      layout: { padding: { top: 10, bottom: 10, left: 10, right: 10 } },
    }
  }

  const shortRes = await fetch('https://quickchart.io/chart/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chart: config, width: 600, height: 320, backgroundColor: '#201E1F', version: '2' }),
  })
  const shortJson = await shortRes.json()
  const shortUrl  = shortJson.url
  if (!shortUrl) throw new Error('QuickChart error: ' + JSON.stringify(shortJson))
  return shortUrl
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

function parseRange(str) {
  if (!str) return [null, 'All Time']
  const m = str.match(/^(\d+)(d|w|m|y)$/i)
  if (!m) return [null, 'All Time']
  const n = parseInt(m[1])
  const unit = m[2].toLowerCase()
  const days = n * { d: 1, w: 7, m: 30, y: 365 }[unit]
  const names = { d: ['Day','Days'], w: ['Week','Weeks'], m: ['Month','Months'], y: ['Year','Years'] }
  const [sing, plur] = names[unit]
  return [days, `${n} ${n === 1 ? sing : plur}`]
}

async function buildChartUrl(rows, rangeLabel = 'All Time', opts = {}) {
  const title   = `Kendu Holders - ${rangeLabel}`
  const step    = Math.max(1, Math.floor(rows.length / 40))
  const sampled = rows.filter((_, i) => i % step === 0 || i === rows.length - 1)
  const labels  = sampled.map(r => r.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))
  const data    = sampled.map(r => r.total)

  const datasets = [{
    label: 'Holders',
    data,
    borderColor: '#FF6B4A',
    backgroundColor: 'rgba(255,107,74,0.2)',
    borderWidth: 3,
    pointRadius: 0,
    fill: true,
    lineTension: 0.3,
    yAxisID: 'y',
  }]
  const yAxes = [{ id: 'y', position: 'left', ticks: { fontColor: '#ffffff', fontSize: 11 }, gridLines: { color: 'rgba(255,255,255,0.15)' } }]

  if (opts.mcSeries?.length) {
    datasets.push({
      label: 'Market Cap ($M)',
      data: sampled.map(r => {
        const mc = nearestMc(opts.mcSeries, r.date)
        return mc == null ? null : mc / 1e6
      }),
      borderColor: '#5AC8FA',
      backgroundColor: 'rgba(90,200,250,0.15)',
      borderWidth: 2,
      pointRadius: 0,
      fill: false,
      lineTension: 0.3,
      yAxisID: 'y2',
      spanGaps: true,
    })
    yAxes.push({ id: 'y2', position: 'right', scaleLabel: { display: true, labelString: 'MC ($M)', fontColor: '#5AC8FA' }, ticks: { fontColor: '#5AC8FA', fontSize: 11 }, gridLines: { display: false } })
  }

  const config = {
    type: 'line',
    data: { labels, datasets },
    options: {
      legend: { display: !!opts.mcSeries?.length, labels: { fontColor: '#ffffff' } },
      title: { display: true, text: title, fontColor: '#FF6B4A', fontSize: 14, fontStyle: 'bold' },
      scales: {
        xAxes: [{ ticks: { fontColor: '#ffffff', maxTicksLimit: 5, maxRotation: 0, fontSize: 11 }, gridLines: { color: 'rgba(255,255,255,0.15)' } }],
        yAxes,
      },
      layout: { padding: { top: 10, bottom: 10, left: 10, right: 10 } },
    }
  }

  const shortRes = await fetch('https://quickchart.io/chart/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chart: config, width: 600, height: 320, backgroundColor: '#201E1F', version: '2' }),
  })
  const shortJson = await shortRes.json()
  const shortUrl  = shortJson.url
  if (!shortUrl) throw new Error('QuickChart error: ' + JSON.stringify(shortJson))
  return shortUrl
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
        `<b>Kendu Dashboard Bot</b>\n\n` +
        `Commands:\n` +
        `/price — ETH price + Kendu MC\n` +
        `/mcap — Kendu MC\n` +
        `/hhi — Current HHI index\n` +
        `/gas — Current ETH gas fees\n` +
        `/wen — X to MC\n` +
        `/calc — Holdings value calculator\n` +
        `/gains — Gains calculator\n` +
        `/impact — Price impact calculator\n` +
        `/holders — Holders chart\n` +
        `/volume — Volume chart\n` +
        `/snapshot — Generate 24h snapshot\n` +
        `/dashboard — Open the dashboard`
      )

    } else if (text.startsWith('/price')) {
      const { ethPrice, ethChange, kenduChange } = await getPrice()
      const mc = await getMCap()
      const fmtChange = c => c == null ? '' : ` ${c > 0 ? '▲' : '▼'} ${Math.abs(c).toFixed(2)}% (24h)`
      const ethStr = ethPrice != null ? `$${ethPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'
      await sendMessage(chatId,
        `<b>ETH Price</b>\n${ethStr}${fmtChange(ethChange)}\n\n` +
        `<b>Kendu Market Cap</b>\n${fmt(mc)}${fmtChange(kenduChange)}`
      )

    } else if (text.startsWith('/mcap')) {
      const { kenduChange } = await getPrice()
      const mc = await getMCap()
      const fmtChange = c => c == null ? '' : ` ${c > 0 ? '▲' : '▼'} ${Math.abs(c).toFixed(2)}% (24h)`
      await sendMessage(chatId, `<b>Kendu Market Cap</b>\n${fmt(mc)}${fmtChange(kenduChange)}`)

    } else if (text.startsWith('/holders')) {
      const parts = text.split(/\s+/).slice(1)
      const wantsPrice = parts[parts.length - 1] === 'price'
      if (wantsPrice) parts.pop()
      const [rangeDays, rangeLabel] = parseRange(parts[0])

      const rows = await fetchHoldersCSV()
      if (!rows.length) { await sendMessage(chatId, 'Error loading holder data.'); return res.status(200).send('OK') }

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
        (dBase != null && dBase !== 0 ? `  Base ${sign(dBase)}` : '') +
        (dSol  != null && dSol  !== 0 ? `  Sol ${sign(dSol)}`  : '')

      const caption =
        `<b>Total Holders: ${latest.total.toLocaleString()}</b>\n` +
        `ETH: ${isFinite(latest.eth) ? latest.eth.toLocaleString() : '—'}  ` +
        `Base: ${isFinite(latest.base) && latest.base > 0 ? latest.base.toLocaleString() : '—'}  ` +
        `Sol: ${isFinite(latest.sol) && latest.sol > 0 ? latest.sol.toLocaleString() : '—'}` +
        deltaLine

      let mcSeries = null
      if (wantsPrice) {
        const spanDays = Math.ceil((Date.now() - rangeRows[0].date.getTime()) / 86400000) + 2
        const mcDays = Math.min(365, Math.max(7, rangeDays || spanDays))
        mcSeries = await getVolumeCandles(mcDays).catch(() => [])
      }

      const chartUrl = await buildChartUrl(rangeRows, rangeLabel, { mcSeries })
      await sendPhoto(chatId, chartUrl, caption)

    } else if (text.startsWith('/gas') || text.startsWith('/gwei')) {
      const gas = await getGas()
      await sendMessage(chatId,
        `<b>Current Gas Fees</b>\n` +
        `Fast: ${gas.fast.toFixed(2)} GWEI\n` +
        `Std: ${gas.standard.toFixed(2)} GWEI\n` +
        `Eco: ${gas.eco.toFixed(2)} GWEI`
      )

    } else if (text.startsWith('/hhi')) {
      const hhi = await getHHI()
      await sendMessage(chatId, `<b>HHI Concentration:</b> ${hhiLabel(hhi)}\n${hhi.toFixed(0)}/10,000`)

    } else if (text.startsWith('/volume')) {
      const parts = text.split(/\s+/).slice(1)
      const wantsPrice = parts[parts.length - 1] === 'price'
      if (wantsPrice) parts.pop()
      const [parsedDays, parsedLabel] = parseRange(parts[0])

      if (parsedDays != null && parsedDays > 180) {
        await sendMessage(chatId, '180D max for /volume.')
        return res.status(200).send('OK')
      }

      const days = Math.max(7, parsedDays ?? 180)
      const rangeLabel = parsedDays != null ? parsedLabel : '180 Days'

      const [candles, total24h] = await Promise.all([getVolumeCandles(days), getVolume24h()])
      if (!candles.length) { await sendMessage(chatId, 'Error loading volume data.'); return res.status(200).send('OK') }

      const totalRange = candles.reduce((a, c) => a + c.vol, 0)
      const caption =
        `<b>Volume (${rangeLabel})</b>\n` +
        `24H: ${fmt(total24h)}\n` +
        `Total: ${fmt(totalRange)}`

      const chartUrl = await buildVolumeChartUrl(candles, rangeLabel, { overlayMc: wantsPrice })
      await sendPhoto(chatId, chartUrl, caption)

    } else if (text.startsWith('/snapshot')) {
      const imgRes = await fetch('https://kendu-dashboard.com/api/snapshot-image')
      if (!imgRes.ok) throw new Error('Snapshot render failed')
      const buf = await imgRes.arrayBuffer()
      const form = new FormData()
      form.append('chat_id', String(chatId))
      form.append('photo', new Blob([buf], { type: 'image/png' }), 'kendu-snapshot.png')
      await fetch(`https://api.telegram.org/bot${TOKEN}/sendPhoto`, { method: 'POST', body: form })

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
          `<b>Usage:</b>\n/calc [token amount] — e.g. /calc 500M\n/calc [token amount] [target MC] — e.g. /calc 500M 1B\n/calc [tier] — e.g. /calc whale`
        )
      } else {
        const mc = await getMCap()
        const pricePerToken = mc / SUPPLY
        const currentValue  = tokens * pricePerToken
        const currentTier   = tierFor(tokens)

        const lines = [
          `<b>Holding:</b> ${tokens >= 1e9 ? (tokens / 1e9).toFixed(2) + 'B' : (tokens / 1e6).toFixed(2) + 'M'} tokens`,
          `<b>Current MC:</b> ${fmt(mc)}`,
          `<b>Current value:</b> ${fmt(currentValue)}`,
          `<b>Tier:</b> ${currentTier?.name ?? '—'}`,
        ]

        if (targetMC) {
          const targetValue = tokens * (targetMC / SUPPLY)
          const multiplier  = targetValue / currentValue
          lines.push(``)
          lines.push(`<b>Target MC:</b> ${fmt(targetMC)}`)
          lines.push(`<b>Value @ target:</b> ${fmt(targetValue)}`)
          lines.push(`<b>Multiplier:</b> ${multiplier.toFixed(2)}x`)
        }

        await sendMessage(chatId, lines.join('\n'))
      }

    } else if (text.startsWith('/gains')) {
      const parts = text.split(/\s+/).slice(1)
      const invested = parseMC(parts[0])
      const buyMC    = parseMC(parts[1])

      const hasSuffix = /[kmbt]$/i.test(parts[0] || '') && /[kmbt]$/i.test(parts[1] || '')

      if (!invested || !buyMC || !hasSuffix) {
        await sendMessage(chatId,
          `<b>Usage:</b> /gains [dollar amount] [buy MC]\n` +
          `E.g. /gains 500 2.5M\n` +
          `E.g. /gains 1K 500K\n\n` +
          `Both values must include a unit (K, M, B)`
        )
      } else {
        const currentMC  = await getMCap()
        const multiplier = currentMC / buyMC
        const value      = invested * multiplier
        const pnl        = value - invested
        const pnlSign    = pnl >= 0 ? '+' : ''
        const fmtUSD     = n => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

        await sendMessage(chatId,
          `<b>Gains Calculator</b>\n\n` +
          `<b>Invested:</b> ${fmtUSD(invested)}\n` +
          `<b>Buy MC:</b> ${fmt(buyMC)}\n` +
          `<b>Current MC:</b> ${fmt(currentMC)}\n\n` +
          `<b>Multiplier:</b> ${multiplier.toFixed(2)}x (${pnlSign}${((multiplier - 1) * 100).toFixed(0)}%)\n` +
          `<b>Current value:</b> ${fmtUSD(value)}\n` +
          `<b>PNL:</b> ${pnlSign}${fmtUSD(pnl)}`
        )
      }

    } else if (text.startsWith('/why')) {
      await sendMessage(chatId, 'Because fuck you, thats why.')

    } else if (text.startsWith('/wen')) {
      const parts = text.split(/\s+/).slice(1)
      const targetMC = parseMC(parts[0])
      const hasSuffix = /[kmbt]$/i.test(parts[0] || '')

      if (!parts[0] || !targetMC || !hasSuffix) {
        await sendMessage(chatId, 'Everybody asks wen, but nobody asks /why')
      } else {
        const currentMC  = await getMCap()
        const multiplier = targetMC / currentMC
        await sendMessage(chatId, `${multiplier.toFixed(2)}x until ${fmt(targetMC)}`)
      }

    } else if (text.startsWith('/approve')) {
      await sendPhoto(chatId, 'https://kendu-dashboard.com/APPROVED.jpg', '')
    } else if (text.startsWith('/certify')) {
      await sendPhoto(chatId, 'https://kendu-dashboard.com/CERTIFIED.jpg', '')
    } else if (text.startsWith('/true')) {
      await sendPhoto(chatId, 'https://kendu-dashboard.com/TRUE.jpg', '')
    } else if (text.startsWith('/maybe')) {
      await sendPhoto(chatId, 'https://kendu-dashboard.com/MAYBE.jpg', '')
    } else if (text.startsWith('/deny')) {
      await sendPhoto(chatId, 'https://kendu-dashboard.com/DENIED.jpg', '')
    } else if (text.startsWith('/false')) {
      await sendPhoto(chatId, 'https://kendu-dashboard.com/FALSE.jpg', '')
    } else if (text.startsWith('/ctoshi')) {
      await sendPhoto(chatId, 'https://kendu-dashboard.com/ctoshi.jpg', '@C_toshi')

    } else if (text.startsWith('/duderino')) {
      await sendMessage(chatId, 'Please accept my apology.')

    } else if (text.startsWith('/chad')) {
      await sendPhoto(chatId, 'https://kendu-dashboard.com/CHAD.JPG', '')
    } else if (text.startsWith('/shakira')) {
      await sendPhoto(chatId, 'https://kendu-dashboard.com/shakira.webp', '')
    } else if (text.startsWith('/lorniko')) {
      await sendMessage(chatId, 'Good Morniko 😍')

    } else if (text.startsWith('/sofinished')) {
      await sendMessage(chatId, 'soSmart')

    } else if (text.startsWith('/cliff')) {
      await sendMessage(chatId, 'Spicy Chad.')

    } else if (text.startsWith('/impact')) {
      const args = text.replace('/impact', '').trim()
      const isMCMode = args.startsWith('mc ')
      const amtStr   = isMCMode ? args.slice(3).trim() : args
      const amt      = parseMC(amtStr)

      if (!amtStr || !amt) {
        await sendMessage(chatId,
          `<b>Usage:</b>\n/impact [buy amount] — e.g. /impact 50k\n/impact mc [target MC] — e.g. /impact mc 1b`
        )
      } else {
        const { currentMC, liquidity, effLiq } = await getImpactData()
        if (!currentMC || !effLiq) throw new Error('Could not fetch market data')
        const price = currentMC / SUPPLY

        if (isMCMode) {
          const required = impactRequiredBuy(currentMC, effLiq, amt)
          if (!required || required <= 0) {
            await sendMessage(chatId, `Target MC must be higher than current MC (${fmt(currentMC)}).`)
          } else {
            const { pctChange } = impactCalcMC(currentMC, effLiq, required)
            await sendMessage(chatId,
              `<b>Price Impact — Target MC</b>\n\n` +
              `Current MC: <b>${fmt(currentMC)}</b>\n` +
              `Target MC: <b>${fmt(amt)}</b> <i>(+${pctChange.toFixed(1)}%)</i>\n\n` +
              `Required Buy: <b>${fmt(required)}</b>`
            )
          }
        } else {
          const { newMC, pctChange } = impactCalcMC(currentMC, effLiq, amt)
          const CHAIN_NAMES = { eth: 'ETH', base: 'BASE', sol: 'SOL' }
          const chainLines = ['eth', 'base', 'sol'].map(chain => {
            const liq = liquidity[chain]
            if (!liq) return null
            const received = impactTokens(liq, price, amt)
            const slippage = amt / (liq / 2 + amt) * 100
            const tokStr   = received >= 1e9 ? (received / 1e9).toFixed(2) + 'B'
                           : received >= 1e6 ? (received / 1e6).toFixed(2) + 'M'
                           : received.toFixed(0)
            return `${CHAIN_NAMES[chain]}: <b>${tokStr} KENDU</b> (${slippage.toFixed(2)}% slip)`
          }).filter(Boolean)

          await sendMessage(chatId,
            `<b>Price Impact — Buy ${fmt(amt)}</b>\n\n` +
            `Current MC: <b>${fmt(currentMC)}</b>\n` +
            `New MC: <b>${fmt(newMC)}</b> <i>(+${pctChange.toFixed(1)}%)</i>\n\n` +
            `<b>Tokens Received:</b>\n` +
            chainLines.join('\n')
          )
        }
      }

    } else if (text.startsWith('/kenduwood')) {
      await sendMessage(chatId, '3D Printed Chad.')

    } else if (text.startsWith('/wafe')) {
      await sendMessage(chatId, 'The Kendu wafe starts with small volume increases')

    } else if (text.startsWith('/bad') || text.startsWith('/seejoshnudes')) {
      const mp4 = await fetch('https://kendu-dashboard.com/api/video')
      const buf = await mp4.arrayBuffer()
      const form = new FormData()
      form.append('chat_id', String(chatId))
      form.append('animation', new Blob([buf], { type: 'video/mp4' }), 'modern-family.mp4')
      await fetch(`https://api.telegram.org/bot${TOKEN}/sendAnimation`, { method: 'POST', body: form })

    } else if (text.startsWith('/nadine')) {
      await sendMessage(chatId, 'NO MORE COMMANDS.')

    } else if (text.startsWith('/dashboard')) {
      await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: '<b>Kendu Dashboard</b>',
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[
              { text: '🚀 Open Dashboard', web_app: { url: 'https://kendu-dashboard.com' } }
            ]]
          }
        })
      })
    }
  } catch (e) {
    await sendMessage(chatId, `Error: ${e.message}`)
  }

  res.status(200).send('OK')
}
