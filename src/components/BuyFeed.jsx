import React, { useState, useEffect, useCallback } from 'react'
import RefreshButton from './RefreshButton.jsx'
import CollapseButton from './CollapseButton.jsx'
import { fmtNum } from '../utils/index.js'
import { KENDU_ETH_CA, LPS, TIER_DEFS } from '../utils/constants.js'
import styles from './BuyFeed.module.css'

const POOL = LPS.eth.address.toLowerCase()
const POLL_MS = 30_000

function tierForTokens(tok) {
  if (!isFinite(tok) || tok <= 0) return null
  return TIER_DEFS.find(t => tok >= t.min && tok < t.max) || TIER_DEFS[TIER_DEFS.length - 1]
}

function shortAddr(addr) {
  return addr.slice(0, 6) + '…' + addr.slice(-4)
}

function timeAgo(ts) {
  const secs = Math.floor((Date.now() / 1000) - ts)
  if (secs < 60)  return `${secs}s ago`
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

export default function BuyFeed({ collapsed, onToggle }) {
  const [txns, setTxns]         = useState([])
  const [spinning, setSpinning] = useState(false)

  const fetchFeed = useCallback(async () => {
    setSpinning(true)
    try {
      const r = await fetch(
        `/api/etherscan?module=account&action=tokentx&contractaddress=${KENDU_ETH_CA}&address=${LPS.eth.address}&sort=desc&page=1&offset=50`
      )
      const j = await r.json()
      if (j.status !== '1' || !Array.isArray(j.result)) return
      const rows = j.result.map(tx => {
        const isBuy  = tx.from.toLowerCase() === POOL
        const tokens = Number(tx.value) / 1e18
        const tier   = tierForTokens(tokens)
        return { hash: tx.hash, ts: parseInt(tx.timeStamp), isBuy, tokens, tier, wallet: isBuy ? tx.to : tx.from }
      })
      setTxns(rows)
    } finally {
      setSpinning(false)
    }
  }, [])

  useEffect(() => {
    fetchFeed()
    const id = setInterval(fetchFeed, POLL_MS)
    return () => clearInterval(id)
  }, [fetchFeed])

  return (
    <div className={`k-card ${styles.wrap}`}>
      <div className={styles.head}>
        <div>
          <div className="k-eyebrow">ETHEREUM</div>
          <div className={styles.title}>FEED</div>
        </div>
        <div className="k-head-actions">
          <RefreshButton spinning={spinning} onClick={fetchFeed} />
          <CollapseButton collapsed={collapsed} onToggle={onToggle} />
        </div>
      </div>

      <div className={`k-body${collapsed ? ' k-collapsed' : ''}`}><div className="k-body-inner">
        <div className={styles.feed}>
          {txns.length === 0 && <div className={styles.empty}>No transactions yet…</div>}
          {txns.map(tx => (
            <a
              key={tx.hash}
              className={`${styles.row} ${tx.isBuy ? styles.buy : styles.sell}`}
              href={`https://etherscan.io/tx/${tx.hash}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className={styles.badge}>{tx.isBuy ? '▲ BUY' : '▼ SELL'}</span>
              <span className={styles.tokens}>{fmtNum(tx.tokens)} KENDU</span>
              {tx.tier && <span className={styles.tier}>{tx.tier.name}</span>}
              <span className={styles.meta}>
                <span className={styles.wallet}>{shortAddr(tx.wallet)}</span>
                <span className={styles.time}>· {timeAgo(tx.ts)}</span>
              </span>
            </a>
          ))}
        </div>

        <div className="k-foot">UPDATED EVERY 30 SECONDS</div>
      </div></div>
    </div>
  )
}
