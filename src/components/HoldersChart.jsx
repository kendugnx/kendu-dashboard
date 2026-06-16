import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import RefreshButton from './RefreshButton.jsx'
import CollapseButton from './CollapseButton.jsx'
import { useRefresh } from '../hooks/useRefresh.js'
import { fetchCSV, fmtNum, fmtUSD, fmtUpdated } from '../utils/index.js'
import { niceTicks, responsivePad, drawYGrid, drawXLabels, drawLine } from '../utils/chart.js'
import { HOLDERS_CSV_URL, MC_CSV_URL, KENDU_ETH_CA } from '../utils/constants.js'
import { API } from '../utils/apiBase.js'
import styles from './HoldersChart.module.css'

function pickBestPair(pairs) {
  const eth = (pairs || []).filter(p => (p.chainId || '').toLowerCase() === 'ethereum')
  const arr = eth.length ? eth : (pairs || [])
  arr.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))
  return arr[0]
}

const RANGES = ['All', '1Y', '6M', '1M', '1W', '3D']
const MA_OPTS = [9, 26, 50, 200]

function parseCustomRange(str) {
  if (!str) return null
  const m = str.trim().toUpperCase().match(/^(\d+(?:\.\d+)?)\s*([DWMY])$/)
  if (!m) return null
  const n = parseFloat(m[1])
  const unit = m[2]
  const multipliers = { D: 1, W: 7, M: 30.44, Y: 365 }
  return Math.round(n * multipliers[unit])
}

function parseHoldersCSV(text) {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return []
  const header = lines[0].split(',').map(s => s.trim().toLowerCase().replace(/[^a-z0-9]/g,''))
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
    let d
    if (/^\d{4}-\d{2}-\d{2}$/.test(dstr)) {
      const [y, m, dd] = dstr.split('-').map(Number)
      d = new Date(y, m - 1, dd)
    } else { d = new Date(dstr) }
    if (!isFinite(d.getTime())) continue
    const num = idx => idx >= 0 ? Number(String(cols[idx] ?? '').replace(/[^\d.\-]/g,'')) : NaN
    const eth   = num(ethIdx)
    const base  = num(baseIdx)
    const sol   = num(solIdx)
    const total = isFinite(num(totalIdx)) ? num(totalIdx) : [eth, base, sol].filter(isFinite).reduce((a,b)=>a+b,0)
    if (!isFinite(total) || total <= 0) continue
    rows.push({ d, eth, base, sol, total })
  }
  rows.sort((a, b) => a.d - b.d)
  return rows
}

function parseMCCSV(text) {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return []
  const header = lines[0].split(',').map(s => s.trim().toLowerCase().replace(/[^a-z0-9]/g,''))
  const dateIdx = header.findIndex(h => /^date$|^day$/.test(h))
  const mcIdx   = header.findIndex(h => /mc|marketcap|market/.test(h))
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(s => s.trim())
    const dstr = cols[dateIdx]
    if (!dstr) continue
    let d
    if (/^\d{4}-\d{2}-\d{2}$/.test(dstr)) {
      const [y, m, dd] = dstr.split('-').map(Number)
      d = new Date(y, m - 1, dd)
    } else { d = new Date(dstr) }
    if (!isFinite(d.getTime())) continue
    const mc = Number(String(cols[mcIdx] ?? '').replace(/[^\d.\-]/g,''))
    if (isFinite(mc) && mc > 0) rows.push({ d, mc })
  }
  rows.sort((a, b) => a.d - b.d)
  return rows
}

function movingAvg(rows, n) {
  return rows.map((_, i) => {
    const slice = rows.slice(Math.max(0, i - n + 1), i + 1)
    const vals = slice.map(r => r.total).filter(isFinite)
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN
  })
}

function filterByDays(rows, days) {
  if (days == null || !rows.length) return rows
  const cutoff = Date.now() - days * 86400 * 1000
  return rows.filter(r => r.d.getTime() >= cutoff)
}

function filterByRange(rows, range) {
  if (range === 'All' || !rows.length) return rows
  const days = { '1Y': 365, '6M': 182, '3M': 91, '1M': 30, '1W': 7, '7D': 7, '3D': 3 }[range]
  return filterByDays(rows, days)
}

function joinByDate(holdRows, mcRows) {
  const mcMap = new Map(mcRows.map(r => [r.d.toDateString(), r.mc]))
  return holdRows.map(r => ({ ...r, mc: mcMap.get(r.d.toDateString()) ?? NaN }))
}

// ---- Canvas draw ----
function drawChart(ctx, W, H, series, maLines, activeMAs, showMC, tooltipIdx) {
  if (!series.length) return

  const N    = series.length
  const vals = series.map(r => r.total).filter(isFinite)
  const yT   = niceTicks(Math.min(...vals), Math.max(...vals), 5)

  const fontSize0 = W < 420 ? 11 : W < 640 ? 12 : 13
  ctx.font = `${fontSize0}px 'Asap Condensed',system-ui,-apple-system,sans-serif`
  const maxLabelW = Math.max(...yT.ticks.map(v => ctx.measureText(fmtNum(v)).width))

  const basePad = responsivePad(W, maxLabelW)
  const pad = showMC ? { ...basePad, r: W < 640 ? 56 : 72 } : basePad
  const plotW = W - pad.l - pad.r
  const plotH = H - pad.t - pad.b
  const xScale = i => pad.l + (N <= 1 ? 0 : (i / (N - 1)) * plotW)
  const yTScale = v => pad.t + plotH - ((v - yT.min) / (yT.max - yT.min || 1)) * plotH

  let yMScale = null
  let yM = null
  if (showMC) {
    const mcVals = series.map(r => r.mc).filter(isFinite)
    if (mcVals.length) {
      yM = niceTicks(Math.min(...mcVals), Math.max(...mcVals), 5)
      yMScale = v => pad.t + plotH - ((v - yM.min) / (yM.max - yM.min || 1)) * plotH
    }
  }

  drawYGrid(ctx, yT, pad, plotW, plotH, fmtNum, pad.axisFontSize)

  if (yMScale && yM) {
    const isLight = typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'light'
    ctx.fillStyle  = isLight ? '#201E1F' : '#E8E6EE'
    ctx.font       = `${pad.axisFontSize}px 'Asap Condensed',system-ui,-apple-system,sans-serif`
    ctx.textAlign  = 'left'
    ctx.textBaseline = 'middle'
    for (const v of yM.ticks) {
      ctx.fillText(fmtUSD(v), pad.l + plotW + 6, yMScale(v))
    }
  }

  drawXLabels(ctx, series, xScale, pad, plotH, pad.axisFontSize, plotW)

  // MC line
  if (showMC && yMScale) {
    const mcPts = series
      .map((r, i) => isFinite(r.mc) ? { x: xScale(i), y: yMScale(r.mc), mc: r.mc } : null)
      .filter(Boolean)
    if (mcPts.length > 1) {
      ctx.beginPath()
      ctx.moveTo(mcPts[0].x, mcPts[0].y)
      for (let i = 1; i < mcPts.length; i++) {
        const a = mcPts[i - 1], b = mcPts[i]
        const dx = (b.x - a.x) * 0.3
        ctx.bezierCurveTo(a.x + dx, a.y, b.x - dx, b.y, b.x, b.y)
      }
      const grad = ctx.createLinearGradient(mcPts[0].x, 0, mcPts[mcPts.length-1].x, 0)
      const totalW = mcPts[mcPts.length-1].x - mcPts[0].x || 1
      for (let i = 0; i < mcPts.length; i++) {
        const stop = (mcPts[i].x - mcPts[0].x) / totalW
        const isUp = i === 0
          ? mcPts.length > 1 && mcPts[1].mc >= mcPts[0].mc
          : mcPts[i].mc >= mcPts[i-1].mc
        grad.addColorStop(Math.min(1, Math.max(0, stop)), isUp ? '#24c65b' : '#ff5e57')
      }
      ctx.strokeStyle = grad
      ctx.lineWidth = 2
      ctx.setLineDash([])
      ctx.stroke()
    }
    if (tooltipIdx != null && tooltipIdx >= 0 && tooltipIdx < N) {
      const r = series[tooltipIdx]
      if (isFinite(r.mc)) {
        const prev = series.slice(0, tooltipIdx).reverse().find(s => isFinite(s.mc))
        const dotColor = prev ? (r.mc >= prev.mc ? '#24c65b' : '#ff5e57') : '#24c65b'
        const xd = xScale(tooltipIdx), yd = yMScale(r.mc)
        const isLightDot = typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'light'
        ctx.fillStyle = isLightDot ? '#FFFFFF' : '#E6EDF3'
        ctx.strokeStyle = dotColor
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(xd, yd, 5, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
      }
    }
  }

  // MA lines
  for (const n of activeMAs) {
    const maVals = maLines[n]
    if (!maVals) continue
    const scaleY = (showMC && yMScale) ? yMScale : yTScale
    const colors = { 9: '#a78bfa', 26: '#38bdf8', 50: '#fb923c', 200: '#f43f5e' }
    ctx.strokeStyle = colors[n] || '#888'
    ctx.lineWidth   = 1.5
    ctx.setLineDash([])
    ctx.beginPath()
    let started = false
    for (let i = 0; i < N; i++) {
      if (!isFinite(maVals[i])) continue
      const x = xScale(i), y = scaleY(maVals[i])
      if (!started) { ctx.moveTo(x, y); started = true }
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }

  // Holders line
  {
    const pts = series.map((r, i) => ({ x: xScale(i), y: yTScale(r.total) }))
    ctx.strokeStyle = '#F05C4E'
    ctx.lineWidth = 3
    ctx.setLineDash([])
    ctx.beginPath()
    if (pts.length > 0) {
      ctx.moveTo(pts[0].x, pts[0].y)
      for (let i = 1; i < pts.length; i++) {
        const prev = pts[i - 1], curr = pts[i]
        const dx = (curr.x - prev.x) * 0.3
        ctx.bezierCurveTo(prev.x + dx, prev.y, curr.x - dx, curr.y, curr.x, curr.y)
      }
    }
    ctx.stroke()
  }

  // Tooltip crosshair + dot
  if (tooltipIdx != null && tooltipIdx >= 0 && tooltipIdx < N) {
    const x = xScale(tooltipIdx)
    ctx.strokeStyle = 'rgba(240,92,78,.4)'
    ctx.lineWidth   = 1
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.moveTo(x, pad.t)
    ctx.lineTo(x, pad.t + plotH)
    ctx.stroke()
    ctx.setLineDash([])

    const y = yTScale(series[tooltipIdx].total)
    if (isFinite(y)) {
      ctx.fillStyle = '#F05C4E'
      ctx.beginPath()
      ctx.arc(x, y, 5, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

export default function HoldersChart({ collapsed, onToggle }) {
  const [allHolders, setAllHolders] = useState([])
  const [allMC,      setAllMC]      = useState([])
  const [range,      setRange]      = useState('All')
  const [customInput, setCustomInput] = useState('')
  const [customDays,  setCustomDays]  = useState(null)
  const [activeMAs,  setActiveMAs]  = useState([])
  const [showMC,     setShowMC]     = useState(false)
  const [updatedTs,  setUpdatedTs]  = useState(null)
  const [tooltipIdx, setTooltipIdx] = useState(null)
  const [tooltipData, setTooltipData] = useState(null)
  const [tooltipPos,  setTooltipPos]  = useState({ x: 0, y: 0 })

  const canvasRef = useRef(null)
  const wrapRef   = useRef(null)

  const series = useMemo(() => {
    const filtered = customDays != null
      ? filterByDays(allHolders, customDays)
      : filterByRange(allHolders, range)
    if (allMC.length) return joinByDate(filtered, allMC)
    return filtered
  }, [allHolders, allMC, range, customDays])

  const maLines = useMemo(() => {
    const result = {}
    for (const n of MA_OPTS) result[n] = movingAvg(series, n)
    return result
  }, [series])

  const maMCLines = useMemo(() => {
    const result = {}
    for (const n of MA_OPTS) {
      result[n] = series.map((_, i) => {
        const slice = series.slice(Math.max(0, i - n + 1), i + 1)
        const vals = slice.map(r => r.mc).filter(isFinite)
        return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN
      })
    }
    return result
  }, [series])

  const latestRow  = series[series.length - 1]
  const firstRow   = series[0]
  const eth   = latestRow?.eth
  const base  = latestRow?.base
  const sol   = latestRow?.sol
  const total = latestRow?.total
  const isAllTime = customDays == null && range === 'All'
  const delta = isAllTime
    ? (isFinite(total) ? total : 0)
    : (isFinite(total) && isFinite(firstRow?.total))
      ? total - firstRow.total
      : isFinite(total) ? total : 0

  const rangeLabel = customDays != null
    ? customInput.toUpperCase()
    : range === 'All' ? 'ALL TIME' : range

  const loadData = useCallback(async () => {
    const IS_DEV = import.meta.env.DEV
    const [holdTxt, mcTxt, dexJson] = await Promise.all([
      fetchCSV(HOLDERS_CSV_URL),
      fetchCSV(MC_CSV_URL).catch(() => ''),
      fetch(IS_DEV
        ? API.dex(`/latest/dex/tokens/${KENDU_ETH_CA}`)
        : API.dexscreener(`type=token&address=${encodeURIComponent(KENDU_ETH_CA)}`),
        { cache: 'no-store' }
      ).then(r => r.json()).catch(() => null),
    ])
    setAllHolders(parseHoldersCSV(holdTxt))
    const mcRows = mcTxt ? parseMCCSV(mcTxt) : []
    const livePair = pickBestPair(dexJson?.pairs || [])
    const liveMC = livePair ? (Number(livePair.marketCap || 0) || 0) : 0
    if (isFinite(liveMC) && liveMC > 0) {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const todayStr = today.toDateString()
      const filtered = mcRows.filter(r => r.d.toDateString() !== todayStr)
      filtered.push({ d: today, mc: liveMC })
      filtered.sort((a, b) => a.d - b.d)
      setAllMC(filtered)
    } else if (mcRows.length) {
      setAllMC(mcRows)
    }
    setUpdatedTs(Date.now())
  }, [])

  const { spinning, trigger } = useRefresh(loadData)

  useEffect(() => { loadData() }, [])

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
    drawChart(ctx, wCss, hCss, series, showMC ? maMCLines : maLines, activeMAs, showMC, tooltipIdx)
  }, [series, maLines, maMCLines, activeMAs, showMC, tooltipIdx])

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
    // Match draw(): pad.r widens when showMC is active
    if (showMC) pad.r = W < 640 ? 56 : 72
    const plotW = W - pad.l - pad.r
    const N     = series.length
    if (N < 2) return
    const idx  = Math.round(((mx - pad.l) / plotW) * (N - 1))
    const clampedIdx = Math.max(0, Math.min(N - 1, idx))
    setTooltipIdx(clampedIdx)
    setTooltipData(series[clampedIdx])
    setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
  }, [series, showMC])

  const handleMouseLeave = useCallback(() => {
    setTooltipIdx(null)
    setTooltipData(null)
  }, [])

  const toggleMA = n => setActiveMAs(prev => prev.includes(n) ? prev.filter(x => x !== n) : [...prev, n])

  const handleCustomSubmit = e => {
    if (e.key === 'Enter' || e.type === 'blur') {
      const days = parseCustomRange(customInput)
      if (days) {
        setCustomDays(days)
        setRange('')
      } else if (!customInput.trim()) {
        setCustomDays(null)
        if (!range) setRange('All')
      }
    }
  }

  const handleRangeChip = r => {
    setRange(r === range && customDays == null ? 'All' : r)
    setCustomDays(null)
    setCustomInput('')
  }

  return (
    <div className={`k-card ${styles.wrap}`}>
      <div className={styles.head}>
        <div>
          <div className="k-eyebrow">Total Holders</div>
          <div className={styles.bigNum}>{isFinite(total) ? fmtNum(total) : '—'}</div>
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
        <div className={styles.rightChips}>
          <div className={`${styles.maChips} ${showMC ? styles.visible : ''}`}>
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
            className={`k-chip ${showMC ? 'active' : ''}`}
            onClick={() => { setShowMC(v => !v); if (showMC) setActiveMAs([]) }}
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
        {tooltipData && (() => {
          const wW  = wrapRef.current?.clientWidth  || 600
          const wH  = wrapRef.current?.clientHeight || 360
          const TW  = 190, TH = 190
          const left = tooltipPos.x + TW + 16 > wW ? tooltipPos.x - TW - 8 : tooltipPos.x + 12
          const top  = tooltipPos.y + TH + 16 > wH ? tooltipPos.y - TH - 8 : tooltipPos.y + 12
          return (
            <div className={styles.tooltip} style={{ left: Math.max(4, left), top: Math.max(4, top) }}>
              <div className={styles.tooltipDate}>
                {tooltipData.d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </div>
              {isFinite(tooltipData.eth)  && <div className={styles.tooltipRow}><span>ETH:</span><span>{fmtNum(tooltipData.eth)}</span></div>}
              {isFinite(tooltipData.base) && tooltipData.base > 0 && <div className={styles.tooltipRow}><span>BASE:</span><span>{fmtNum(tooltipData.base)}</span></div>}
              {isFinite(tooltipData.sol)  && tooltipData.sol > 0  && <div className={styles.tooltipRow}><span>SOL:</span><span>{fmtNum(tooltipData.sol)}</span></div>}
              {isFinite(tooltipData.total) && <div className={`${styles.tooltipRow} ${styles.tooltipHighlight}`}><span>TOTAL:</span><span>{fmtNum(tooltipData.total)}</span></div>}
              {isFinite(tooltipData.total) && (() => {
                const dh = isAllTime ? tooltipData.total : tooltipData.total - (firstRow?.total ?? 0)
                return <div className={styles.tooltipRow}><span>Δ HOLDERS:</span><span>{dh >= 0 ? '+' : ''}{fmtNum(dh)}</span></div>
              })()}
              {showMC && isFinite(tooltipData.mc) && <div className={`${styles.tooltipRow} ${styles.tooltipHighlight}`}><span>MC:</span><span>{fmtUSD(tooltipData.mc)}</span></div>}
              {showMC && isFinite(tooltipData.mc) && (() => {
                const dm = isAllTime ? tooltipData.mc : tooltipData.mc - (isFinite(firstRow?.mc) ? firstRow.mc : tooltipData.mc)
                return <div className={styles.tooltipRow}><span>Δ MC:</span><span>{dm >= 0 ? '+' : ''}{fmtUSD(dm)}</span></div>
              })()}
            </div>
          )
        })()}
      </div>

      <div className={styles.statsRow}>
        {[['ETH', eth], ['BASE', base], ['SOL', sol]]
          .filter(([,v]) => isFinite(v) && v > 0).map(([label, val]) => (
          <div key={label} className={styles.statPill}>
            <span className={styles.statLabel}>{label}:</span>
            <span className={styles.statVal}>{fmtNum(val)}</span>
          </div>
        ))}
        <div className={`${styles.statPill} ${styles.statHighlight}`}>
          <span className={styles.statLabel}>TOTAL:</span>
          <span className={styles.statVal}>{isFinite(total) ? fmtNum(total) : '—'}</span>
        </div>
        <div className={styles.statPill}>
          <span className={styles.statLabel}>Δ ({rangeLabel}):</span>
          <span className={styles.statVal}>{delta >= 0 ? '+' : ''}{fmtNum(delta)}</span>
        </div>
      </div>

      <div className="k-foot">{fmtUpdated(updatedTs)}</div>
      </div></div>
    </div>
  )
}
