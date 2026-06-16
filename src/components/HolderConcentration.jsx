import React, { useState, useEffect, useCallback } from 'react'
import RefreshButton from './RefreshButton.jsx'
import CollapseButton from './CollapseButton.jsx'
import { useRefresh } from '../hooks/useRefresh.js'
import { fmtUpdated, computeHHI, hhiLabel } from '../utils/index.js'
import { HHI_EXCLUDED_ADDRESSES } from '../utils/constants.js'
import styles from './HolderConcentration.module.css'

const HHI_MAX = 10000

export default function HolderConcentration({ collapsed, onToggle }) {
  const [holders,   setHolders]   = useState(null)
  const [updatedTs, setUpdatedTs] = useState(null)

  const loadData = useCallback(async () => {
    const res = await fetch('/api/holders?limit=100').then(r => r.json()).catch(() => null)
    setHolders(Array.isArray(res) ? res : null)
    setUpdatedTs(Date.now())
  }, [])

  const { spinning, trigger } = useRefresh(loadData)
  useEffect(() => { loadData() }, [])

  const hhi   = holders ? computeHHI(holders, HHI_EXCLUDED_ADDRESSES) : null
  const label = hhiLabel(hhi)
  const frac  = hhi != null ? Math.min(1, Math.max(0, hhi / HHI_MAX)) : 0

  // SVG ring
  const RADIUS = 80
  const CIRC   = 2 * Math.PI * RADIUS
  const offset = CIRC * (1 - frac)

  return (
    <div className={`k-card ${styles.wrap}`}>
      <div className={styles.head}>
        <div>
          <div className="k-eyebrow">Holder Concentration</div>
          <div className={styles.hhiNum}>{hhi != null ? hhi.toFixed(0) : '—'}</div>
        </div>
        <div className="k-head-actions">
          <RefreshButton spinning={spinning} onClick={trigger} />
          <CollapseButton collapsed={collapsed} onToggle={onToggle} />
        </div>
      </div>

      <div className={`k-body${collapsed ? ' k-collapsed' : ''}`}><div className="k-body-inner">
        <div className={styles.ringArea}>
          <div className={styles.ringWrap}>
            <svg className={styles.ring} viewBox="0 0 200 200">
              <circle cx="100" cy="100" r={RADIUS} fill="none" stroke="rgba(240,92,78,.2)" strokeWidth="12" />
              <circle
                cx="100" cy="100" r={RADIUS}
                fill="none"
                stroke="#F05C4E"
                strokeWidth="12"
                strokeLinecap="butt"
                strokeDasharray={CIRC}
                strokeDashoffset={offset}
                transform="rotate(-90 100 100)"
                style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(.22,.61,.36,1)' }}
              />
            </svg>
            <div className={styles.ringCenter}>
              <div className={styles.ringNum}>{hhi != null ? hhi.toFixed(0) : '—'}<span className={styles.ringDenom}>/{HHI_MAX.toLocaleString()}</span></div>
              <div className={styles.ringSub}>{label} Concentration</div>
            </div>
          </div>
        </div>

        <div className={styles.explainer}>HHI score based on the top 100 ETH holders, excluding bridges, liquidity pools, and exchange wallets.</div>

        <div className="k-foot">{fmtUpdated(updatedTs)}</div>
      </div></div>
    </div>
  )
}
