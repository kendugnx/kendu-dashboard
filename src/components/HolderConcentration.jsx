import React, { useState, useEffect, useCallback } from 'react'
import RefreshButton from './RefreshButton.jsx'
import CollapseButton from './CollapseButton.jsx'
import { useRefresh } from '../hooks/useRefresh.js'
import { fmtUpdated, computeHHI, hhiLabel } from '../utils/index.js'
import styles from './HolderConcentration.module.css'

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

  const hhi   = holders ? computeHHI(holders) : null
  const label = hhiLabel(hhi)
  const top5  = holders ? holders.slice(0, 5) : []

  return (
    <div className={`k-card ${styles.wrap}`}>
      <div className={styles.head}>
        <div>
          <div className="k-eyebrow">Holder Concentration</div>
          <div className={styles.hhiNum}>
            {hhi != null ? hhi.toFixed(0) : '—'}
            {hhi != null && <span className={styles.hhiTag}>{label}</span>}
          </div>
        </div>
        <div className="k-head-actions">
          <RefreshButton spinning={spinning} onClick={trigger} />
          <CollapseButton collapsed={collapsed} onToggle={onToggle} />
        </div>
      </div>

      <div className={`k-body${collapsed ? ' k-collapsed' : ''}`}><div className="k-body-inner">
        <div className={styles.explainer}>HHI (Herfindahl-Hirschman Index), based on the top 100 ETH holders' share of supply. Lower means more distributed.</div>

        {top5.length > 0 && (
          <div className={styles.top5}>
            {top5.map((h, i) => (
              <div key={h.address} className={styles.top5Row}>
                <span className={styles.top5Rank}>#{i + 1}</span>
                <span className={styles.top5Addr}>{h.ens || (h.address.slice(0, 6) + '…' + h.address.slice(-4))}</span>
                <span className={styles.top5Share}>{Number(h.share).toFixed(2)}%</span>
              </div>
            ))}
          </div>
        )}

        <div className="k-foot">{fmtUpdated(updatedTs)}</div>
      </div></div>
    </div>
  )
}
