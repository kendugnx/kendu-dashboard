import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import RefreshButton from './RefreshButton.jsx'
import CollapseButton from './CollapseButton.jsx'
import { useRefresh } from '../hooks/useRefresh.js'
import { fmtUSD, fmtUpdated } from '../utils/index.js'
import { niceTicks, responsivePad, drawYGrid, drawXLabels } from '../utils/chart.js'
import styles from './VolumeChart.module.css'

const RANGES = ['30D', '60D', '90D', '180D', '1Y']
const RANGE_DAYS = { '30D': 30, '60D': 60, '90D': 90, '180D': 180, '1Y': 365 }

function fmtVol(v) {
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M'
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(0) + 'K'
  return '$' + v.toFixed(0)
}

function drawVolChart(ctx, W, H, series, tooltipIdx) {
  if (!series.length) return

  const N    = series.length
  const vols = series.map(r => r.vol)
  const yT   = niceTicks(0, Math.max(...vols) * 1.08, 5)

  const fontSize0 = W < 420 ? 11 : 13
  ctx.font = `${fontSize0}px 'Asap Condensed',system-ui,sans-serif`
  const maxLW = Math.max(...yT.ticks.map(v => ctx.measureText(fmtVol(v)).width))

  const pad   = responsivePad(W, maxLW)
  const plotW = W - pad.l - pad.r
  const plotH = H - pad.t - pad.b

  const yScale = drawYGrid(ctx, yT, pad, plotW, plotH, fmtVol, pad.axisFontSize)
  drawXLabels(ctx, series, i => pad.l + (N <= 1 ? 0 : (i / (N - 1)) * plotW), pad, plotH, pad.axisFontSize, plotW)

  const barW = Math.max(2, Math.floor(plotW / N) - 1)

  for (let i = 0; i < N; i++) {
    const x    = pad.l + (plotW / N) * i + (plotW / N - barW) / 2
    const yTop = yScale(series[i].vol)
    const yBot = yScale(0)
    const h    = Math.max(1, yBot - yTop)
    const isHover = i === tooltipIdx

    ctx.fillStyle = isHover ? '#F05C4E' : 'rgba(240, 92, 78, 0.55)'
    ctx.fillRect(Math.floor(x), Math.floor(yTop), barW, Math.ceil(h))
  }
}

export default function VolumeChart({ collapsed, onToggle }) {
  const [range, setRange]       = useState('90D')
  const [series, setSeries]     = useState([])
  const [updatedTs, setUpdatedTs] = useState(null)
  const [tooltipIdx, setTooltipIdx] = useState(null)
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })

  const canvasRef = useRef(null)
  const wrapRef   = useRef(null)

  const fetchVolume = useCallback(async () => {
    const days = RANGE_DAYS[range] || 90
    const r = await fetch(`/api/volume?days=${days}`)
    const j = await r.json()
    if (!Array.isArray(j)) return
    const rows = j.map(d => ({
      d: new Date(d.date * 1000),
      vol: parseFloat(d.dailyVolumeUSD) || 0,
    }))
    setSeries(rows)
    setUpdatedTs(Date.now())
  }, [range])

  const { spinning, trigger } = useRefresh(fetchVolume)
  useEffect(() => { fetchVolume() }, [fetchVolume])

  const totalVol = useMemo(() => series.reduce((s, r) => s + r.vol, 0), [series])
  const avgVol   = series.length ? totalVol / series.length : 0
  const lastVol  = series[series.length - 1]?.vol ?? 0

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const wrap   = wrapRef.current
    if (!canvas || !wrap) return
    const wCss = wrap.clientWidth
    const hCss = wCss < 640 ? 220 : 300
    const dpr  = Math.max(1, Math.min(3, window.devicePixelRatio || 1))
    canvas.style.width  = wCss + 'px'
    canvas.style.height = hCss + 'px'
    canvas.width  = Math.floor(wCss * dpr)
    canvas.height = Math.floor(hCss * dpr)
    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, wCss, hCss)
    drawVolChart(ctx, wCss, hCss, series, tooltipIdx)
  }, [series, tooltipIdx])

  useEffect(() => {
    draw()
    const wrap = wrapRef.current
    if (!wrap) return
    const ro = new ResizeObserver(draw)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [draw])

  const handleMouseMove = useCallback(e => {
    const canvas = canvasRef.current
    const wrap   = wrapRef.current
    if (!canvas || !series.length || !wrap) return
    const rect  = canvas.getBoundingClientRect()
    const mx    = e.clientX - rect.left
    const W     = rect.width
    const pad   = responsivePad(W)
    const plotW = W - pad.l - pad.r
    const N     = series.length
    const idx   = Math.floor(((mx - pad.l) / plotW) * N)
    const clamped = Math.max(0, Math.min(N - 1, idx))
    setTooltipIdx(clamped)
    setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
  }, [series])

  const handleMouseLeave = useCallback(() => setTooltipIdx(null), [])

  return (
    <div className={`k-card ${styles.wrap}`}>
      <div className={styles.head}>
        <div>
          <div className="k-eyebrow">ETH Pool · Uniswap V2</div>
          <div className={styles.title}>Daily Volume</div>
        </div>
        <div className="k-head-actions">
          <RefreshButton spinning={spinning} onClick={trigger} />
          <CollapseButton collapsed={collapsed} onToggle={onToggle} />
        </div>
      </div>

      <div className={`k-body${collapsed ? ' k-collapsed' : ''}`}><div className="k-body-inner">
        <div className={styles.controls}>
          {RANGES.map(r => (
            <button key={r} className={`k-chip ${range === r ? 'active' : ''}`} onClick={() => setRange(r)}>{r}</button>
          ))}
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
            const wW  = wrapRef.current?.clientWidth  || 600
            const wH  = wrapRef.current?.clientHeight || 300
            const TW  = 160, TH = 70
            const left = tooltipPos.x + TW + 16 > wW ? tooltipPos.x - TW - 8 : tooltipPos.x + 12
            const top  = tooltipPos.y + TH + 16 > wH ? tooltipPos.y - TH - 8 : tooltipPos.y + 12
            return (
              <div className={styles.tooltip} style={{ left, top }}>
                <div className={styles.tooltipDate}>
                  {row.d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </div>
                <div className={styles.tooltipVol}>{fmtUSD(row.vol)}</div>
              </div>
            )
          })()}
        </div>

        <div className={styles.statsRow}>
          <div className={styles.stat}><span className={styles.statLabel}>Last Day</span><span className={styles.statVal}>{fmtUSD(lastVol)}</span></div>
          <div className={styles.stat}><span className={styles.statLabel}>Avg Daily ({range})</span><span className={styles.statVal}>{fmtUSD(avgVol)}</span></div>
          <div className={styles.stat}><span className={styles.statLabel}>Total ({range})</span><span className={styles.statVal}>{fmtUSD(totalVol)}</span></div>
        </div>

        <div className="k-foot">{fmtUpdated(updatedTs)}</div>
      </div></div>
    </div>
  )
}
