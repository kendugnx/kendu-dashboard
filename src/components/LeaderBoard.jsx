import React, { useState, useEffect, useCallback } from 'react'
import RefreshButton from './RefreshButton.jsx'
import CollapseButton from './CollapseButton.jsx'
import { fmtNum, fmtUpdated } from '../utils/index.js'
import { KENDU_ETH_CA, CIRC_SUPPLY, TIER_DEFS, LPS, TREASURY_WALLET } from '../utils/constants.js'
import styles from './LeaderBoard.module.css'

function tierForTokens(tok) {
  if (!isFinite(tok) || tok <= 0) return null
  return TIER_DEFS.find(t => tok >= t.min && tok < t.max) || TIER_DEFS[TIER_DEFS.length - 1]
}

function shortAddr(addr) {
  return addr.slice(0, 6) + '…' + addr.slice(-4)
}

const LABELS = {
  [LPS.eth.address.toLowerCase()]:       'Uniswap V2 Pool',
  [LPS.base.address.toLowerCase()]:      'Aerodrome Pool',
  [TREASURY_WALLET.toLowerCase()]:       'Treasury',
  '0x000000000000000000000000000000000000dead': '🔥 Burn',
}

export default function LeaderBoard({ collapsed, onToggle }) {
  const [holders, setHolders]   = useState([])
  const [updatedTs, setUpdatedTs] = useState(null)
  const [spinning, setSpinning] = useState(false)

  const fetchHolders = useCallback(async () => {
    setSpinning(true)
    try {
      const r = await fetch('/api/holders?limit=25')
      const j = await r.json()
      if (!Array.isArray(j)) return
      const rows = j.map((h, i) => {
        const balance = h.balance / 1e18
        const pct     = h.share
        const tier    = tierForTokens(balance)
        const label   = LABELS[h.address.toLowerCase()] || null
        return { rank: i + 1, addr: h.address, balance, pct, tier, label, ens: h.ens || null }
      })
      setHolders(rows)
      setUpdatedTs(Date.now())
    } finally {
      setSpinning(false)
    }
  }, [])

  useEffect(() => { fetchHolders() }, [fetchHolders])

  return (
    <div className={`k-card ${styles.wrap}`}>
      <div className={styles.head}>
        <div>
          <div className="k-eyebrow">ETHEREUM</div>
          <div className={styles.title}>TOP HOLDERS</div>
        </div>
        <div className="k-head-actions">
          <RefreshButton spinning={spinning} onClick={fetchHolders} />
          <CollapseButton collapsed={collapsed} onToggle={onToggle} />
        </div>
      </div>

      <div className={`k-body${collapsed ? ' k-collapsed' : ''}`}><div className="k-body-inner">
        {holders.length === 0 && !spinning && (
          <div className={styles.empty}>Loading holders…</div>
        )}
        <div className={styles.list}>
          {holders.map(h => (
            <a
              key={h.addr}
              className={styles.row}
              href={`https://etherscan.io/token/${KENDU_ETH_CA}?a=${h.addr}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className={styles.rank}>#{h.rank}</span>
              <span className={styles.addrCol}>
                {h.label
                  ? <span className={styles.label}>{h.label}</span>
                  : h.ens
                    ? <span className={styles.label}>{h.ens}</span>
                    : <span className={styles.addr}>{shortAddr(h.addr)}</span>
                }
                {h.tier && !h.label && !h.ens && <span className={styles.tier}>{h.tier.name}</span>}
              </span>
              <span className={styles.balance}>{fmtNum(h.balance)}</span>
              <span className={styles.pct}>{h.pct.toFixed(2)}%</span>
            </a>
          ))}
        </div>

        <div className="k-foot" style={{ marginTop: 'auto' }}>{fmtUpdated(updatedTs)}</div>
      </div></div>
    </div>
  )
}
