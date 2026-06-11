import React, { useState, useEffect, useRef, useCallback } from 'react'
import RefreshButton from './RefreshButton.jsx'
import CollapseButton from './CollapseButton.jsx'
import { useRefresh } from '../hooks/useRefresh.js'
import { fmtGwei, fmtUpdated, clamp } from '../utils/index.js'
import { API } from '../utils/apiBase.js'
import styles from './NetworkPulse.module.css'

// URLs resolved via apiBase.js (Vite proxy locally, direct on Vercel)
const STABLES = new Set(['usdt','usdc','busd','dai','tusd','usdd','usde','fdusd','gusd','susd','lusd','pax'])

// ---- Polling functions ----
async function fetchPrice() {
  const r = await fetch(API.coingecko('/simple/price?ids=ethereum&vs_currencies=usd&include_24hr_change=true'), { cache: 'no-store' })
  const j = await r.json()
  return { price: j.ethereum?.usd, change: j.ethereum?.usd_24h_change }
}

async function fetchGasEtherscan() {
  const r = await fetch(API.etherscan('module=gastracker&action=gasoracle'), { cache: 'no-store' })
  if (!r.ok) throw new Error('Etherscan HTTP ' + r.status)
  const j = await r.json()
  if (j.status !== '1') throw new Error(j.message || 'Gas API error')
  const d = j.result
  return {
    base:     Number(d.suggestBaseFee),
    fast:     Number(d.FastGasPrice),
    standard: Number(d.ProposeGasPrice),
    eco:      Number(d.SafeGasPrice),
  }
}

async function fetchGasFeeHistory() {
  const rpcs = import.meta.env.DEV
    ? ['/proxy/ethrpc', '/proxy/ethrpc2', '/proxy/ethrpc3']
    : ['https://rpc.ankr.com/eth', 'https://cloudflare-eth.com', 'https://ethereum.publicnode.com']
  for (const rpc of rpcs) {
    try {
      const body = { jsonrpc: '2.0', id: 1, method: 'eth_feeHistory', params: [5, 'latest', [10, 50, 90]] }
      const r = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      if (!r.ok) continue
      const j = await r.json()
      const res = j?.result
      if (!res) continue
      const baseFees = (res.baseFeePerGas || []).map(h => parseInt(h, 16)).filter(isFinite)
      const baseWei  = baseFees[baseFees.length - 1] ?? baseFees[baseFees.length - 2]
      if (!isFinite(baseWei)) continue
      const rewards = Array.isArray(res.reward) ? res.reward : []
      const pick = idx => {
        const arr = rewards.map(row => parseInt(row[idx], 16)).filter(isFinite)
        arr.sort((a, b) => a - b)
        return arr.length ? arr[Math.floor(arr.length / 2)] : 0
      }
      const toGwei = wei => wei / 1e9
      return {
        base:     toGwei(baseWei),
        fast:     toGwei(baseWei + pick(2)),
        standard: toGwei(baseWei + pick(1)),
        eco:      toGwei(baseWei + pick(0)),
      }
    } catch { /* try next */ }
  }
  throw new Error('Gas feeHistory failed across all RPCs')
}

async function fetchGas() {
  try { return await fetchGasEtherscan() }
  catch { return await fetchGasFeeHistory() }
}

async function fetchFNG() {
  const r = await fetch(API.fng('/fng/?limit=1&format=json'), { cache: 'no-store' })
  const j = await r.json()
  const v = Number(j?.data?.[0]?.value)
  if (!isFinite(v)) throw new Error('FNG: invalid payload')
  return clamp(v, 0, 100)
}

async function fetchAltSeason() {
  // CMC methodology: % of top 100 alts that outperformed BTC over 90 days.
  // Fetches via Vercel serverless proxy to avoid CORS/rate-limit issues.
  const EXCLUDE = new Set([
    'usdt','usdc','busd','dai','tusd','usdd','usde','fdusd','gusd','susd','lusd','pax',
    'wbtc','steth','cbeth','reth','wsteth','beth','clink','weth'
  ])
  try {
    const r = await fetch(
      API.coingecko('/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&price_change_percentage=90d'),
      { cache: 'no-store' }
    )
    const list = await r.json()
    if (!Array.isArray(list)) throw new Error('Bad payload')
    const btc   = list.find(c => c.id === 'bitcoin' || c.symbol?.toLowerCase() === 'btc')
    const btc90 = Number(btc?.price_change_percentage_90d_in_currency)
    if (!isFinite(btc90)) throw new Error('No BTC 90d data')
    const alts = list.filter(c =>
      c.id !== 'bitcoin' &&
      !EXCLUDE.has(String(c.symbol || '').toLowerCase())
    )
    const out = alts.filter(c => Number(c.price_change_percentage_90d_in_currency) > btc90).length
    return clamp(Math.round((out / Math.max(1, alts.length)) * 100), 0, 100)
  } catch {
    throw new Error('Alt season fetch failed')
  }
}

function etaFor(gas, base) {
  if (!isFinite(gas) || !isFinite(base)) return '—'
  if (gas >= base + 5) return '<15s'
  if (gas >= base + 2) return '<60s'
  return '1–3m'
}

function fngClass(score) {
  if (!isFinite(score)) return ''
  if (score < 35) return styles.bearish
  if (score < 65) return styles.neutral
  return styles.bullish
}

function altClass(score) {
  if (!isFinite(score)) return ''
  if (score < 35) return styles.btcSeason
  if (score < 65) return styles.altNeutral
  return styles.altSeason
}

// ---- Component ----
export default function NetworkPulse({ collapsed, onToggle }) {
  const [price,     setPrice]     = useState(null)
  const [change,    setChange]    = useState(null)
  const [gas,       setGas]       = useState(null)
  const [fng,       setFng]       = useState(null)
  const [alt,       setAlt]       = useState(null)
  const [updatedTs, setUpdatedTs] = useState(null)
  const [isLive,    setIsLive]    = useState(false)
  const wsRef = useRef(null)

  // WebSocket for live price
  const connectWS = useCallback(() => {
    if (wsRef.current) return
    try {
      const ws = new WebSocket('wss://ws-feed.exchange.coinbase.com')
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'subscribe', product_ids: ['ETH-USD'], channels: ['ticker'] }))
        setIsLive(true)
      }
      let lastUpdate = 0
      ws.onmessage = e => {
        const now = Date.now()
        if (now - lastUpdate < 1000) return  // max 1 update/sec
        const msg = JSON.parse(e.data)
        if (msg.type === 'ticker' && msg.product_id === 'ETH-USD') {
          const p = parseFloat(msg.price)
          if (!isFinite(p)) return
          lastUpdate = now
          setPrice(p)
          const o = parseFloat(msg.open_24h)
          if (isFinite(o) && o > 0) setChange(((p - o) / o) * 100)
          setUpdatedTs(Date.now())
        }
      }
      ws.onerror = ws.onclose = () => {
        setIsLive(false)
        wsRef.current = null
        fallbackHTTP()
      }
      wsRef.current = ws
    } catch { fallbackHTTP() }
  }, [])

  const fallbackHTTP = useCallback(async () => {
    try {
      const { price: p, change: c } = await fetchPrice()
      if (isFinite(p)) { setPrice(p); setChange(c); setUpdatedTs(Date.now()) }
    } catch {}
  }, [])

  const loadAll = useCallback(async () => {
    await Promise.allSettled([
      fetchPrice().then(({ price: p, change: c }) => { setPrice(p); setChange(c) }),
      fetchGas().then(g => setGas(g)),
      fetchFNG().then(v => setFng(v)),
      fetchAltSeason().then(v => setAlt(v)),
    ])
    setUpdatedTs(Date.now())
  }, [])

  const { spinning, trigger } = useRefresh(loadAll)

  useEffect(() => {
    let mounted = true
    const ws = connectWS()
    fetchGas().then(g => { if (mounted) { setGas(g); setUpdatedTs(Date.now()) } }).catch(() => {})
    // Stagger CoinGecko calls to avoid 429
    setTimeout(() => { if (mounted) fetchFNG().then(v => setFng(v)).catch(() => {}) }, 500)
    setTimeout(() => { if (mounted) fetchAltSeason().then(v => setAlt(v)).catch(() => {}) }, 1500)

    const gasInterval = setInterval(() => fetchGas().then(setGas).catch(() => {}), 30_000)
    const fngInterval = setInterval(() => fetchFNG().then(setFng).catch(() => {}), 300_000)
    const altInterval = setInterval(() => fetchAltSeason().then(setAlt).catch(() => {}), 300_000)
    const httpInterval = setInterval(fallbackHTTP, 30_000)

    return () => {
      mounted = false
      clearInterval(gasInterval)
      clearInterval(fngInterval)
      clearInterval(altInterval)
      clearInterval(httpInterval)
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [])

  const priceText  = price != null && isFinite(price)  ? `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'
  const changeText = change != null && isFinite(change) ? `${change > 0 ? '+' : ''}${change.toFixed(2)}%` : '—%'
  const changePos  = change != null && isFinite(change) && change > 0.01
  const changeNeg  = change != null && isFinite(change) && change < -0.01

  const fngScore  = fng != null && isFinite(fng)  ? fng  : null
  const altScore  = alt != null && isFinite(alt)  ? alt  : null
  const ringCirc  = 502.655  // 2π × 80
  const fngOffset = fngScore != null ? (ringCirc * (1 - fngScore / 100)).toFixed(3) : ringCirc
  const altOffset = altScore != null ? (ringCirc * (1 - altScore / 100)).toFixed(3) : ringCirc

  return (
    <div className={`k-card ${styles.wrap}`}>
      {/* ---- Shared header (always visible) ---- */}
      <div className={styles.cardHead}>
        <div className={styles.titleBlock}>
          <span className="k-eyebrow">Network Pulse</span>
          <strong className={styles.title}>Ethereum</strong>
        </div>
        <div className="k-head-actions">
          <span className={`${styles.livePill} ${isLive ? styles.live : styles.polling}`}>
            {isLive ? 'Live' : 'Polling'}
          </span>
          <RefreshButton spinning={spinning} onClick={trigger} />
          <CollapseButton collapsed={collapsed} onToggle={onToggle} />
        </div>
      </div>

      {/* ---- Collapsible body ---- */}
      <div className={`k-body${collapsed ? ' k-collapsed' : ''}`}>
      <div className="k-body-inner">

      {/* ---- Desktop layout ---- */}
      <div className={styles.desktop}>

        <div className={styles.desktopBody}>
          {/* Fear & Greed ring */}
          <div className={styles.miniMeter}>
            <svg className={styles.ring} viewBox="0 0 200 200">
              <circle className={styles.track} cx="100" cy="100" r="80" />
              <circle
                className={`${styles.bar} ${fngClass(fngScore)}`}
                cx="100" cy="100" r="80"
                style={{ strokeDashoffset: fngOffset }}
              />
            </svg>
            <div className={styles.meterCaption}>
              <span className={styles.meterVal}>{fngScore ?? '—'}</span>
              <span className={styles.meterLabel}>Fear &<br/>Greed</span>
            </div>
          </div>

          {/* Price block */}
          <div className={styles.priceBlock}>
            <span className="k-eyebrow" style={{ textAlign: 'center' }}>Spot Price</span>
            <div className={styles.bigPrice}>{priceText}</div>
            <div className={styles.priceChange}>
              <span className={styles.periodLabel}>24H</span>
              <span className={changePos ? 'pos' : changeNeg ? 'neg' : ''}>
                {changeText}
              </span>
            </div>
            <div className={styles.gasTiers}>
              {[['Fast', gas?.fast], ['Std', gas?.standard], ['Eco', gas?.eco]].map(([label, val]) => (
                <div key={label} className={styles.gasTier}>
                  <span className={styles.gasLabel}>{label}</span>
                  <span className={styles.gasVal}>{fmtGwei(val)} <span className={styles.gasUnit}>GWEI</span></span>
                  <span className={styles.gasEta}>{etaFor(val, gas?.base)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Alt Season ring */}
          <div className={styles.miniMeter}>
            <svg className={styles.ring} viewBox="0 0 200 200">
              <circle className={styles.track} cx="100" cy="100" r="80" />
              <circle
                className={`${styles.bar} ${altClass(altScore)}`}
                cx="100" cy="100" r="80"
                style={{ strokeDashoffset: altOffset }}
              />
            </svg>
            <div className={styles.meterCaption}>
              <span className={styles.meterVal}>{altScore ?? '—'}</span>
              <span className={styles.meterLabel}>Alt<br/>Season</span>
            </div>
          </div>
        </div>

        <div className="k-foot">{fmtUpdated(updatedTs)}</div>
      </div>

      {/* ---- Mobile layout ---- */}
      <div className={styles.mobile}>
        <div className={styles.mobilePriceRow}>
          <span className={styles.mobileBig}>{priceText}</span>
          <span className={`${styles.mobileChange} ${changePos ? 'pos' : changeNeg ? 'neg' : ''}`}>
            <span className={styles.periodLabel}>24H</span> {changeText}
          </span>
        </div>

        <div className={styles.mobileGasTiers}>
          {[['Fast', gas?.fast], ['Std', gas?.standard], ['Eco', gas?.eco]].map(([label, val]) => (
            <div key={label} className={styles.mobileGasItem}>
              <strong>{label}</strong>
              <span className={styles.gasVal}>{fmtGwei(val)} GWEI</span>
              <span className={styles.gasEta}>{etaFor(val, gas?.base)}</span>
            </div>
          ))}
        </div>

        <div className={styles.mobileMeters}>
          <div className={`${styles.mobileMeter} ${fngClass(fngScore)}`}>
            <span className={styles.mobileLabel}>Fear & Greed</span>
            <span className={styles.mobileMeterVal}>{fngScore ?? '—'}</span>
            <div className={styles.mobileProgress}>
              <div className={styles.mobileProgressBar} style={{ width: `${fngScore ?? 0}%` }} />
            </div>
          </div>
          <div className={`${styles.mobileMeter} ${altClass(altScore)}`}>
            <span className={styles.mobileLabel}>Altseason</span>
            <span className={styles.mobileMeterVal}>{altScore ?? '—'}</span>
            <div className={styles.mobileProgress}>
              <div className={styles.mobileProgressBar} style={{ width: `${altScore ?? 0}%` }} />
            </div>
          </div>
        </div>

        <div className="k-foot">{fmtUpdated(updatedTs)}</div>
      </div>

      </div>{/* k-body-inner */}
      </div>{/* k-body */}
    </div>
  )
}
