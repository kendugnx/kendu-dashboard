import React, { useState, useEffect, useCallback, useRef } from 'react'
import RefreshButton from './RefreshButton.jsx'
import CollapseButton from './CollapseButton.jsx'
import { useRefresh } from '../hooks/useRefresh.js'
import { fetchCSV, fmtNum, fmtUpdated, computeHHI, hhiLabel } from '../utils/index.js'
import { HOLDERS_CSV_URL } from '../utils/constants.js'
import styles from './HolderComposition.module.css'

const CHAINS = [
  { key: 'eth',  label: 'ETH',  color: '#F05C4E' },
  { key: 'sol',  label: 'SOL',  color: '#D9804A' },
  { key: 'base', label: 'BASE', color: '#DFA45F' },
]

function parseLatestRow(text) {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return null
  const header = lines[0].split(',').map(s => s.trim().toLowerCase().replace(/[^a-z0-9]/g,''))
  const ethIdx   = header.findIndex(h => /eth/.test(h))
  const baseIdx  = header.findIndex(h => /base/.test(h))
  const solIdx   = header.findIndex(h => /sol/.test(h))
  const totalIdx = header.findIndex(h => /total/.test(h))
  for (let i = lines.length - 1; i >= 1; i--) {
    const cols = lines[i].split(',').map(s => s.trim())
    const num = idx => idx >= 0 ? Number(String(cols[idx] ?? '').replace(/[^\d]/g,'')) : NaN
    const eth   = num(ethIdx)
    const base  = num(baseIdx)
    const sol   = num(solIdx)
    const total = isFinite(num(totalIdx)) ? num(totalIdx)
      : [eth, base, sol].filter(isFinite).reduce((a,b)=>a+b, 0)
    if (isFinite(total) && total > 0) return { eth, base, sol, total }
  }
  return null
}

// ---- SVG donut ----
function DonutChart({ data, hovered, onHover }) {
  const RADIUS = 80
  const CIRC   = 2 * Math.PI * RADIUS
  const total  = data.reduce((a, d) => a + d.value, 0)
  if (!total) return null

  let cumulative = 0
  const slices = data.map(d => {
    const frac   = d.value / total
    const dash   = frac * CIRC
    const gap    = CIRC - dash
    const offset = CIRC * (1 - cumulative / total)
    cumulative  += d.value
    return { ...d, frac, dash, gap, offset }
  })

  return (
    <svg viewBox="0 0 200 200" className={styles.donut}>
      {/* Track */}
      <circle cx="100" cy="100" r={RADIUS} fill="none" stroke="rgba(240,92,78,.2)" strokeWidth="12" />
      {/* Segments */}
      {slices.map(s => (
        <circle
          key={s.key}
          cx="100" cy="100" r={RADIUS}
          fill="none"
          stroke={s.color}
          strokeWidth="12"
          strokeLinecap="butt"
          strokeDasharray={`${s.dash} ${s.gap}`}
          strokeDashoffset={s.offset}
          transform="rotate(-90 100 100)"
          style={{
            opacity: hovered && hovered !== s.key ? 0.35 : 1,
            transition: 'opacity 0.2s ease',
            cursor: 'pointer',
          }}
          onMouseEnter={() => onHover(s.key)}
          onMouseLeave={() => onHover(null)}
        />
      ))}
    </svg>
  )
}

export default function HolderComposition({ collapsed, onToggle }) {
  const [data,      setData]      = useState(null)
  const [hovered,   setHovered]   = useState(null)
  const [updatedTs, setUpdatedTs] = useState(null)
  const [hhi,       setHhi]       = useState(null)

  const loadData = useCallback(async () => {
    const [txt, holdersRes] = await Promise.all([
      fetchCSV(HOLDERS_CSV_URL),
      fetch('/api/holders?limit=100').then(r => r.json()).catch(() => null),
    ])
    setData(parseLatestRow(txt))
    setHhi(Array.isArray(holdersRes) ? computeHHI(holdersRes) : null)
    setUpdatedTs(Date.now())
  }, [])

  const { spinning, trigger } = useRefresh(loadData)
  useEffect(() => { loadData() }, [])

  const total = data?.total ?? 0
  const chainData = CHAINS.map(c => ({
    ...c,
    value: data?.[c.key] ?? 0,
    pct: data && total > 0 ? ((data[c.key] ?? 0) / total * 100).toFixed(1) : '0.0',
  }))

  const activeChain = hovered ? chainData.find(c => c.key === hovered) : null

  return (
    <div className={`k-card ${styles.wrap}`}>
      <div className={styles.head}>
        <div>
          <div className="k-eyebrow">Holder Composition</div>
          <div className={styles.bigNum}>
            {fmtNum(activeChain ? activeChain.value : total)}
            {activeChain && (
              <span className={styles.chainMeta}> {activeChain.label} · {activeChain.pct}%</span>
            )}
          </div>
        </div>
        <div className="k-head-actions">
          <RefreshButton spinning={spinning} onClick={trigger} />
          <CollapseButton collapsed={collapsed} onToggle={onToggle} />
        </div>
      </div>

      <div className={`k-body${collapsed ? ' k-collapsed' : ''}`}><div className="k-body-inner">
      {/* Desktop: donut */}
      <div className={styles.desktop}>
        <div className={styles.donutWrap}>
          <DonutChart data={chainData} hovered={hovered} onHover={setHovered} />
          <div className={styles.donutCenter}>
            <div className={styles.legend}>
              {chainData.map(c => (
                <div
                  key={c.key}
                  className={`${styles.legRow} ${hovered === c.key ? styles.legOn : hovered ? styles.legOff : ''}`}
                  onMouseEnter={() => setHovered(c.key)}
                  onMouseLeave={() => setHovered(null)}
                >
                  <span className={styles.swatch} style={{ background: c.color }} />
                  <span className={styles.legLabel}>{c.label}</span>
                  <span className={styles.legPct}>{c.pct}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Mobile: horizontal bar */}
      <div className={styles.mobile}>
        <div className={styles.mobileLegend}>
          {chainData.map(c => (
            <div
              key={c.key}
              className={`${styles.mobileLegRow} ${hovered === c.key ? styles.legOn : hovered ? styles.legOff : ''}`}
              onClick={() => setHovered(h => h === c.key ? null : c.key)}
            >
              <span className={styles.swatch} style={{ background: c.color }} />
              <span className={styles.legLabel}>{c.label}</span>
              <span className={styles.legPct}>{c.pct}%</span>
            </div>
          ))}
        </div>
        <div className={styles.mobileBar}>
          {chainData.map(c => (
            <div
              key={c.key}
              className={styles.mobileBarSeg}
              style={{
                width: `${c.pct}%`,
                background: c.color,
                opacity: hovered && hovered !== c.key ? 0.3 : 1,
                transform: hovered === c.key ? 'scaleY(1.4)' : 'scaleY(1)',
              }}
            />
          ))}
        </div>
      </div>

      {hhi != null && (
        <div className={styles.hhiRow}>
          <span className={styles.hhiLabel}>HHI Concentration</span>
          <span className={styles.hhiVal}>
            {hhi.toFixed(0)} <span className={styles.hhiTag}>{hhiLabel(hhi)}</span>
          </span>
        </div>
      )}

      <div className="k-foot">{fmtUpdated(updatedTs)}</div>
      </div></div>{/* k-body */}
    </div>
  )
}
