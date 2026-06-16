import React, { useState, useEffect, useCallback } from 'react'
import RefreshButton from './RefreshButton.jsx'
import CollapseButton from './CollapseButton.jsx'
import { useRefresh } from '../hooks/useRefresh.js'
import { fmtUpdated, computeHHI, hhiLabel, hhiColor } from '../utils/index.js'
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
  const color = hhiColor(hhi)
  const frac  = hhi != null ? Math.min(1, Math.max(0, hhi / HHI_MAX)) : 0

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
        {/* Desktop: centered number */}
        <div className={styles.centerArea}>
          <div className={styles.bigVal}>
            {hhi != null ? hhi.toFixed(0) : '—'}<span className={styles.bigDenom}>/{HHI_MAX.toLocaleString()}</span>
          </div>
          <div className={styles.bigSub} style={{ color }}>{label} Concentration</div>
        </div>

        {/* Mobile: progress bar */}
        <div className={styles.mobileBar}>
          <div className={styles.mobileVal}>
            {hhi != null ? hhi.toFixed(0) : '—'}<span className={styles.mobileDenom}>/{HHI_MAX.toLocaleString()}</span>
          </div>
          <div className={styles.mobileBarTrack}>
            <div className={styles.mobileBarFill} style={{ width: `${frac * 100}%`, background: color }} />
          </div>
          <div className={styles.mobileBarLabels}>
            <span>0</span>
            <span style={{ color }}>{label} Concentration</span>
            <span>{HHI_MAX.toLocaleString()}</span>
          </div>
        </div>

        <div className={styles.explainer}>HHI score based on the top 100 ETH holders, excluding bridges, liquidity pools, and exchange wallets.</div>

        <div className="k-foot">{fmtUpdated(updatedTs)}</div>
      </div></div>
    </div>
  )
}
