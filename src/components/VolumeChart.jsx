import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import RefreshButton from './RefreshButton.jsx'
import CollapseButton from './CollapseButton.jsx'
import { useRefresh } from '../hooks/useRefresh.js'
import { fmtUSD, fmtUpdated } from '../utils/index.js'
import { niceTicks, responsivePad, drawYGrid, drawXLabels } from '../utils/chart.js'
import { CIRC_SUPPLY } from '../utils/constants.js'
import styles from './VolumeChart.module.css'

const RANGES  = ['30D', '60D', '90D', '180D']
const RANGE_DAYS = { '30D': 30, '60D': 60, '90D': 90, '180D': 180 }
const MA_OPTS = [9, 26, 50, 200]

function parseCustomRange(str) {
  if (!str) return null
  const m = str.trim().toUpperCase().match(/^(\d+(?:\.\d+)?)\s*([DWM])$/)
  if (!m) return null
  const n = parseFloat(m[1])
  const unit = m[2]
  const multipliers = { D: 1, W: 7, M: 30.44 }
  return Math.round(n * multipliers[unit])
}

function fmtVol(v) {
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M'
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(2) + 'K'
  return '$' + v.toFixed(2)
}

function fmtPrice(v) {
  if (!v) return '$0'
  if (v < 0.000001) return '$' + v.toExponential(2)
  if (v < 0.001)    return '$' + v.toFixed(7)
  if (v < 1)        return '$' + v.toFixed(4)
  return '$' + v.toFixed(2)
}

function movingAvgPrice(rows, n) {
  return rows.map((_, i) => {
    const slice = rows.slice(Math.max(0, i - n + 1), i + 1)
    const vals = slice.map(r => r.price).filter(v => v > 0)
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN
  })
}

function drawVolChart(ctx, W, H, series, maLines, activeMAs, tooltipIdx, showPrice) {
  if (!series.length) return

  const N    = series.length
  const vols = series.map(r => r.vol)
  const yT   = niceTicks(0, Math.max(...vols) * 1.08, 5)

  const fontSize0 = W < 420 ? 11 : 13
  ctx.font = `${fontSize0}px 'Asap Condensed',system-ui,sans-serif`
  const maxLW = Math.max(...yT.ticks.map(v => ctx.measureText(fmtVol(v)).width))

  const pad = responsivePad(W, maxLW)
  if (showPrice) pad.r = W < 640 ? 56 : 72
  const plotW = W - pad.l - pad.r
  const plotH = H - pad.t - pad.b

  const yScale = drawYGrid(ctx, yT, pad, plotW, plotH, fmtVol, pad.axisFontSize)
  drawXLabels(ctx, series, i => pad.l + (N <= 1 ? 0 : (i / (N - 1)) * plotW), pad, plotH, pad.axisFontSize, plotW)

  // Volume bars
  const barW = Math.max(2, Math.floor(plotW / N) - 1)
  for (let i = 0; i < N; i++) {
    const x    = pad.l + (plotW / N) * i + (plotW / N - barW) / 2
    const yTop = yScale(series[i].vol)
    const yBot = yScale(0)
    const h    = Math.max(1, yBot - yTop)
    ctx.fillStyle = i === tooltipIdx ? '#F05C4E' : 'rgba(240, 92, 78, 0.55)'
    ctx.fillRect(Math.floor(x), Math.floor(yTop), barW, Math.ceil(h))
  }

  // MC line + MA lines + right axis
  if (showPrice) {
    // Convert price → MC
    const mcs = series.map(r => r.price > 0 ? r.price * CIRC_SUPPLY : null)
    const validMCs = mcs.filter(v => v != null)
    if (validMCs.length > 1) {
      const minM = Math.min(...validMCs)
      const maxM = Math.max(...validMCs)
      const mRange = maxM - minM || maxM * 0.1
      const mScale = v => pad.t + plotH - ((v - minM) / mRange) * plotH

      // MA lines (on MC scale)
      const maColors = { 9: '#a78bfa', 26: '#38bdf8', 50: '#fb923c', 200: '#f43f5e' }
      for (const n of activeMAs) {
        const maVals = maLines[n]  // already in price; convert to MC inline
        if (!maVals) continue
        ctx.strokeStyle = maColors[n] || '#888'
        ctx.lineWidth = 1.5
        ctx.setLineDash([])
        ctx.beginPath()
        let started = false
        for (let i = 0; i < N; i++) {
          if (!isFinite(maVals[i])) continue
          const x = pad.l + (i / (N - 1)) * plotW
          const y = mScale(maVals[i] * CIRC_SUPPLY)
          if (!started) { ctx.moveTo(x, y); started = true }
          else ctx.lineTo(x, y)
        }
        ctx.stroke()
      }

      // MC line — bezier with up/down gradient matching HoldersChart
      const pts = mcs
        .map((mc, i) => mc != null ? { x: pad.l + (i / (N - 1)) * plotW, y: mScale(mc), mc } : null)
        .filter(Boolean)

      if (pts.length > 1) {
        ctx.beginPath()
        ctx.moveTo(pts[0].x, pts[0].y)
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1], b = pts[i]
          const dx = (b.x - a.x) * 0.3
          ctx.bezierCurveTo(a.x + dx, a.y, b.x - dx, b.y, b.x, b.y)
        }
        const totalW = pts[pts.length - 1].x - pts[0].x || 1
        const grad = ctx.createLinearGradient(pts[0].x, 0, pts[pts.length - 1].x, 0)
        for (let i = 0; i < pts.length; i++) {
          const stop = Math.min(1, Math.max(0, (pts[i].x - pts[0].x) / totalW))
          const isUp = i === 0 ? pts[1]?.mc >= pts[0].mc : pts[i].mc >= pts[i - 1].mc
          grad.addColorStop(stop, isUp ? '#24c65b' : '#ff5e57')
        }
        ctx.strokeStyle = grad
        ctx.lineWidth = 2
        ctx.setLineDash([])
        ctx.stroke()
      }

      // Hover dot
      if (tooltipIdx != null && tooltipIdx >= 0 && tooltipIdx < N && mcs[tooltipIdx] != null) {
        const xd = pad.l + (tooltipIdx / (N - 1)) * plotW
        const yd = mScale(mcs[tooltipIdx])
        const prevMC = mcs.slice(0, tooltipIdx).reverse().find(v => v != null)
        const dotColor = prevMC ? (mcs[tooltipIdx] >= prevMC ? '#24c65b' : '#ff5e57') : '#24c65b'
        const isLight = typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'light'
        ctx.fillStyle = isLight ? '#FFFFFF' : '#E6EDF3'
        ctx.strokeStyle = dotColor
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(xd, yd, 5, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
      }

      // Right axis — reset textBaseline after drawXLabels resets it to 'alphabetic'
      const mTicks = niceTicks(minM, maxM, 4).ticks
      const isLight = typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'light'
      ctx.save()
      ctx.fillStyle    = isLight ? '#201E1F' : '#E8E6EE'
      ctx.font         = `${pad.axisFontSize}px 'Asap Condensed',system-ui,-apple-system,sans-serif`
      ctx.textAlign    = 'left'
      ctx.textBaseline = 'middle'
      for (const tick of mTicks) {
        const y = mScale(tick)
        if (y < pad.t - 2 || y > pad.t + plotH + 2) continue
        ctx.fillText(fmtUSD(tick), pad.l + plotW + 6, y)
      }
      ctx.restore()
    }
  }

  // Crosshair
  if (tooltipIdx != null && tooltipIdx >= 0 && tooltipIdx < N) {
    const x = pad.l + (plotW / N) * tooltipIdx + (plotW / N) / 2
    ctx.strokeStyle = 'rgba(240,92,78,.4)'
    ctx.lineWidth = 1
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.moveTo(x, pad.t)
    ctx.lineTo(x, pad.t + plotH)
    ctx.stroke()
    ctx.setLineDash([])
  }
}

export default function VolumeChart({ collapsed, onToggle }) {
  const [allSeries,   setAllSeries]   = useState([])
  const [volume24h,   setVolume24h]   = useState(null)
  const [range,       setRange]       = useState('90D')
  const [customInput, setCustomInput] = useState('')
  const [customDays,  setCustomDays]  = useState(null)
  const [showPrice,   setShowPrice]   = useState(false)
  const [activeMAs,   setActiveMAs]   = useState([])
  const [updatedTs,   setUpdatedTs]   = useState(null)
  const [tooltipIdx,  setTooltipIdx]  = useState(null)
  const [tooltipPos,  setTooltipPos]  = useState({ x: 0, y: 0 })

  const canvasRef = useRef(null)
  const wrapRef   = useRef(null)

  const fetchVolume = useCallback(async () => {
    const r = await fetch('/api/volume?days=180')
    const j = await r.json()
    const candles = Array.isArray(j) ? j : (j?.candles ?? [])
    if (!candles.length) return
    const vol24 = j?.volume24h != null ? parseFloat(j.volume24h) : null
    const todayUtc = new Date().toDateString()
    const rows = candles.map(d => {
      const date = new Date(d.date * 1000)
      const isToday = date.toDateString() === todayUtc
      const vol = (isToday && vol24 != null) ? vol24 : (parseFloat(d.dailyVolumeUSD) || 0)
      return { d: date, vol, price: parseFloat(d.priceUSD) || 0 }
    })
    setAllSeries(rows)
    setVolume24h(vol24)
    setUpdatedTs(Date.now())
  }, [])

  const { spinning, trigger } = useRefresh(fetchVolume)
  useEffect(() => { fetchVolume() }, [fetchVolume])

  const series = useMemo(() => {
    if (!allSeries.length) return []
    if (customDays != null) {
      const cutoff = Date.now() - customDays * 86400 * 1000
      return allSeries.filter(r => r.d.getTime() >= cutoff)
    }
    const days = RANGE_DAYS[range]
    if (!days) return allSeries
    const cutoff = Date.now() - days * 86400 * 1000
    return allSeries.filter(r => r.d.getTime() >= cutoff)
  }, [allSeries, range, customDays])

  const maLines = useMemo(() => {
    const result = {}
    for (const n of MA_OPTS) result[n] = movingAvgPrice(series, n)
    return result
  }, [series])

  const totalVol = useMemo(() => series.reduce((s, r) => s + r.vol, 0), [series])
  const avgVol   = series.length ? totalVol / series.length : 0
  const rangeLabel = customDays != null ? customInput.toUpperCase() : range

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const wrap   = wrapRef.current
    if (!canvas || !wrap) return
    const wCss = wrap.clientWidth
    const hCss = wCss < 640 ? 260 : 360
    const dpr  = Math.max(1, Math.min(3, window.devicePixelRatio || 1))
    canvas.style.width  = wCss + 'px'
    canvas.style.height = hCss + 'px'
    canvas.width  = Math.floor(wCss * dpr)
    canvas.height = Math.floor(hCss * dpr)
    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, wCss, hCss)
    drawVolChart(ctx, wCss, hCss, series, maLines, activeMAs, tooltipIdx, showPrice)
  }, [series, maLines, activeMAs, tooltipIdx, showPrice])

  useEffect(() => {
    draw()
    const wrap = wrapRef.current
    if (!wrap) return
    const ro = new ResizeObserver(draw)
    ro.observe(wrap)
    // Redraw when theme attribute changes
    const mo = new MutationObserver(draw)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => { ro.disconnect(); mo.disconnect() }
  }, [draw])

  const handleMouseMove = useCallback(e => {
    const canvas = canvasRef.current
    if (!canvas || !series.length) return
    const rect  = canvas.getBoundingClientRect()
    const mx    = e.clientX - rect.left
    const W     = rect.width
    const pad   = responsivePad(W)
    // Match draw(): pad.r widens when chart (MC) overlay is active
    if (showPrice) pad.r = W < 640 ? 56 : 72
    const plotW = W - pad.l - pad.r
    const N     = series.length
    const idx   = Math.floor(((mx - pad.l) / plotW) * N)
    setTooltipIdx(Math.max(0, Math.min(N - 1, idx)))
    setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
  }, [series, showPrice])

  const handleMouseLeave = useCallback(() => setTooltipIdx(null), [])

  const toggleMA = n => setActiveMAs(prev => prev.includes(n) ? prev.filter(x => x !== n) : [...prev, n])

  const handleCustomSubmit = e => {
    if (e.key === 'Enter' || e.type === 'blur') {
      const days = parseCustomRange(customInput)
      if (days) {
        setCustomDays(Math.min(days, 180))
        setRange('')
      } else if (!customInput.trim()) {
        setCustomDays(null)
        if (!range) setRange('90D')
      }
    }
  }

  const handleRangeChip = r => {
    setRange(r === range && customDays == null ? '90D' : r)
    setCustomDays(null)
    setCustomInput('')
  }

  return (
    <div className={`k-card ${styles.wrap}`}>
      <div className={styles.head}>
        <div>
          <div className="k-eyebrow">VOLUME</div>
          <div className={styles.bigNum}>{volume24h != null ? fmtVol(volume24h) : '—'}</div>
        </div>
        <div className="k-head-actions">
          <RefreshButton spinning={spinning} onClick={trigger} />
          <CollapseButton collapsed={collapsed} onToggle={onToggle} />
        </div>
      </div>

      <div className={`k-body${collapsed ? ' k-collapsed' : ''}`}><div className="k-body-inner">
      <div className={styles.controls}>
        <div className={styles.rangeChips}>
          <input
            className={styles.rangeInput}
            placeholder="E.G. 5D, 2W, 4M"
            value={customInput}
            onChange={e => setCustomInput(e.target.value)}
            onKeyDown={handleCustomSubmit}
            onBlur={handleCustomSubmit}
          />
          {RANGES.map(r => (
            <button
              key={r}
              className={`k-chip ${range === r && customDays == null ? 'active' : ''}`}
              onClick={() => handleRangeChip(r)}
            >{r}</button>
          ))}
        </div>
        <div className={`${styles.rightChips} ${showPrice ? styles.expanded : ''}`}>
          <div className={`${styles.maChips} ${showPrice ? styles.visible : ''}`}>
            <div className={styles.maChipsInner}>
              {MA_OPTS.map(n => (
                <button
                  key={n}
                  className={`k-chip ${activeMAs.includes(n) ? 'active' : ''}`}
                  onClick={() => toggleMA(n)}
                >MA {n}</button>
              ))}
            </div>
          </div>
          <button
            className={`k-chip ${showPrice ? 'active' : ''}`}
            onClick={() => { setShowPrice(p => !p); if (showPrice) setActiveMAs([]) }}
          >Chart</button>
        </div>
      </div>

      <div ref={wrapRef} className={styles.chartWrap}>
        <canvas
          ref={canvasRef}
          style={{ display: 'block', width: '100%' }}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        />
        {tooltipIdx != null && series[tooltipIdx] && (() => {
          const row = series[tooltipIdx]
          const mc  = row.price > 0 ? row.price * CIRC_SUPPLY : null
          const wW  = wrapRef.current?.clientWidth  || 600
          const wH  = wrapRef.current?.clientHeight || 360
          const TW  = 190, TH = showPrice ? 110 : 70
          const left = tooltipPos.x + TW + 16 > wW ? tooltipPos.x - TW - 8 : tooltipPos.x + 12
          const top  = Math.max(4, tooltipPos.y + TH + 16 > wH ? tooltipPos.y - TH - 8 : tooltipPos.y + 12)
          return (
            <div className={styles.tooltip} style={{ left, top }}>
              <div className={styles.tooltipDate}>
                {row.d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </div>
              <div className={`${styles.tooltipRow} ${styles.tooltipHighlight}`}>
                <span>VOLUME:</span><span>{fmtVol(row.vol)}</span>
              </div>
              {showPrice && mc != null && (
                <div className={`${styles.tooltipRow} ${styles.tooltipHighlight}`}>
                  <span>MC:</span><span>{fmtUSD(mc)}</span>
                </div>
              )}
            </div>
          )
        })()}
      </div>

      <div className={styles.statsRow}>
        <div className={`${styles.statPill} ${styles.statHighlight}`}>
          <span className={styles.statLabel}>24H:</span>
          <span className={styles.statVal}>{volume24h != null ? fmtVol(volume24h) : '—'}</span>
        </div>
        <div className={styles.statPill}>
          <span className={styles.statLabel}>AVG ({rangeLabel}):</span>
          <span className={styles.statVal}>{fmtVol(avgVol)}</span>
        </div>
        <div className={styles.statPill}>
          <span className={styles.statLabel}>TOTAL ({rangeLabel}):</span>
          <span className={styles.statVal}>{fmtVol(totalVol)}</span>
        </div>
      </div>

      <div className="k-foot">{fmtUpdated(updatedTs)}</div>
      </div></div>
    </div>
  )
}
