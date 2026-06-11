/* ============================================================
   utils/index.js
   Shared helpers used by all widgets.
   ============================================================ */

// ---- CORS-aware JSON fetcher with fallback proxies ----
export async function getJSON(url) {
  const attempts = [
    u => fetch(u, { cache: 'no-store' }),
    u => fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`, { cache: 'no-store' }),
    u => fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(u)}`, { cache: 'no-store' }),
    u => fetch(`https://cors.isomorphic-git.org/${u}`, { cache: 'no-store' }),
    u => fetch(`https://thingproxy.freeboard.io/fetch/${u}`, { cache: 'no-store' }),
  ]
  let lastErr
  for (const attempt of attempts) {
    try {
      const res = await attempt(url)
      if (!res.ok) { lastErr = new Error(`HTTP ${res.status}`); continue }
      const ct = res.headers.get('content-type') || ''
      if (ct.includes('application/json')) return await res.json()
      const text = await res.text()
      try {
        const maybe = JSON.parse(text)
        if (maybe && typeof maybe === 'object' && 'contents' in maybe) {
          const inner = maybe.contents
          return typeof inner === 'string' ? JSON.parse(inner) : inner
        }
        return maybe
      } catch {
        return JSON.parse(text)
      }
    } catch (e) { lastErr = e }
  }
  throw lastErr || new Error('getJSON failed')
}

// ---- CSV text fetcher with Jina proxy fallback ----
export async function fetchCSV(url) {
  const bustUrl = url + (url.includes('?') ? '&' : '?') + 'nocache=' + Date.now()
  const jinaUrl = 'https://r.jina.ai/http://' + String(bustUrl).replace(/^https?:\/\//, '')
  for (const u of [bustUrl, jinaUrl]) {
    try {
      const r = await fetch(u, { cache: 'no-store' })
      if (r.ok) return await r.text()
    } catch { /* try next */ }
  }
  throw new Error('CSV fetch failed')
}

// ---- CSV parser ----
// Returns array of { d: Date, ...numericCols } objects
export function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/)
  if (!lines.length) return []
  const normalize = h => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const headerRaw = lines[0].split(',').map(s => s.trim())
  const header = headerRaw.map(normalize)

  const dateIdx  = header.findIndex(h => /(^date$|^day$|^datetime$)/.test(h))
  const mcIdx    = header.findIndex(h => /(marketcap|market_cap|^mc$)/.test(h))
  const holdIdx  = header.findIndex(h => /(^holders$|^total$|holderseth|totalholders)/.test(h))
  const ethIdx   = header.findIndex(h => /holderseth|eth$/.test(h))
  const baseIdx  = header.findIndex(h => /holdersbase|base$/.test(h))
  const solIdx   = header.findIndex(h => /holderssol|sol$/.test(h))
  const priceIdx = header.findIndex(h => /(^price$|priceusd|close)/.test(h))

  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(s => s.trim())
    const dstr = cols[dateIdx]
    if (!dstr) continue

    let d
    if (/^\d{4}-\d{2}-\d{2}$/.test(dstr)) {
      const [yy, mm, dd] = dstr.split('-').map(Number)
      d = new Date(yy, mm - 1, dd)
    } else if (/^\d+(\.\d+)?$/.test(dstr)) {
      d = new Date(Math.round((parseFloat(dstr) - 25569) * 86400 * 1000))
    } else {
      d = new Date(dstr)
    }
    if (!isFinite(d.getTime())) continue

    const num = (idx) => {
      if (idx < 0) return NaN
      return Number(String(cols[idx] ?? '').replace(/[^\d.\-]/g, ''))
    }

    const mc    = isFinite(num(mcIdx))    ? num(mcIdx)    : (isFinite(num(priceIdx)) ? num(priceIdx) * 996.74e9 : NaN)
    const total = isFinite(num(holdIdx))  ? num(holdIdx)  : NaN
    const eth   = isFinite(num(ethIdx))   ? num(ethIdx)   : NaN
    const base  = isFinite(num(baseIdx))  ? num(baseIdx)  : NaN
    const sol   = isFinite(num(solIdx))   ? num(solIdx)   : NaN

    rows.push({ d, mc, total, eth, base, sol })
  }
  rows.sort((a, b) => a.d - b.d)
  return rows
}

// ---- Number formatters ----
export function fmtUSD(n) {
  if (!isFinite(n)) return '—'
  const a = Math.abs(n)
  if (a >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T'
  if (a >= 1e9)  return '$' + (n / 1e9).toFixed(2)  + 'B'
  if (a >= 1e6)  return '$' + (n / 1e6).toFixed(2)  + 'M'
  if (a >= 1e3)  return '$' + (n / 1e3).toFixed(2)  + 'K'
  return '$' + n.toFixed(2)
}

export function fmtUSDShort(n) {
  if (!isFinite(n)) return '—'
  return fmtUSD(n)
}

export function fmtNum(n) {
  if (!isFinite(n)) return '—'
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

export function fmtPct(n) {
  if (!isFinite(n)) return '—'
  return (n > 0 ? '+' : '') + n.toFixed(2) + '%'
}

export function fmtPctWhole(n) {
  if (!isFinite(n)) return '—'
  const s = n > 0 ? '+' : n < 0 ? '−' : ''
  return s + Math.round(Math.abs(n)) + '%'
}

export function fmtGwei(n) {
  if (!isFinite(n)) return '—'
  if (n >= 100) return n.toFixed(0)
  if (n >= 10)  return n.toFixed(1)
  return n.toFixed(2)
}

// ---- Timestamp formatter ----
export function fmtLocalTime(ts) {
  if (!ts) return '—'
  try {
    const d = new Date(ts)
    if (!isFinite(d.getTime())) return '—'
    const lang = navigator.language || 'en-US'
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    return d.toLocaleString(lang, {
      year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
      timeZone: tz, timeZoneName: 'short',
    })
  } catch { return '—' }
}

export function fmtUpdated(ts) {
  if (!ts) return 'Updated: —'
  return 'Updated: ' + fmtLocalTime(ts)
}

// ---- Parse shorthand amounts (1B, 500M, 10K) ----
export function parseAmount(s) {
  if (!s) return NaN
  s = String(s).trim().toLowerCase().replace(/[\s$,]/g, '')
  let m = 1
  if (s.endsWith('k')) { m = 1e3;  s = s.slice(0, -1) }
  else if (s.endsWith('m')) { m = 1e6;  s = s.slice(0, -1) }
  else if (s.endsWith('b')) { m = 1e9;  s = s.slice(0, -1) }
  else if (s.endsWith('t')) { m = 1e12; s = s.slice(0, -1) }
  const n = Number(s.replace(/[^0-9.]/g, ''))
  return n * m
}

// ---- Clamp ----
export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n))
}

// ---- Sleep ----
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ---- Rolling average ----
export function rollingAvg(rows, days) {
  return rows.map((row, i) => {
    const slice = rows.slice(Math.max(0, i - days + 1), i + 1)
    const vals = slice.map(r => r.total).filter(isFinite)
    if (!vals.length) return NaN
    return vals.reduce((a, b) => a + b, 0) / vals.length
  })
}

// ---- Dexscreener best pair picker ----
export function pickBestPair(pairs) {
  const eth = (pairs || []).filter(p => (p.chainId || '').toLowerCase() === 'ethereum')
  const arr = eth.length ? eth : (pairs || [])
  arr.sort((a, b) => ((b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)))
  return arr[0]
}

// Constants
export const KENDU_ETH_CA   = '0xaa95f26e30001251fb905d264Aa7b00eE9dF6C18'
export const CIRC_SUPPLY    = 996.74e9
export const ETHERSCAN_KEY  = 'M5XZ6NDDYYQ5HY9KVUQDJ12ME484DVEP4A'
export const DEX_TOKEN_URL  = `https://api.dexscreener.com/latest/dex/tokens/${KENDU_ETH_CA}`
