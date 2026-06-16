import React, { useState, useEffect, useRef, useCallback } from 'react'
import html2canvas from 'html2canvas'
import { fmtUSD, fmtNum, getJSON } from '../utils/index.js'
import { API } from '../utils/apiBase.js'
import { KENDU_ETH_CA, LPS, CIRC_SUPPLY } from '../utils/constants.js'
import styles from './SnapshotModal.module.css'

const PAIR_ETH  = LPS.eth.address
const PAIR_BASE = LPS.base.address
const PAIR_SOL  = 'B34Pu6w8eecYRXLEDxBCPy5JoFLy3iycLAPJpYiwbKMK'

async function fetchStats() {
  const [ethRes, baseRes, solRes] = await Promise.allSettled([
    getJSON(API.dex(`/latest/dex/pairs/ethereum/${PAIR_ETH}`)),
    getJSON(API.dex(`/latest/dex/pairs/base/${PAIR_BASE}`)),
    getJSON(API.dex(`/latest/dex/pairs/solana/${PAIR_SOL}`)),
  ])

  function pair(res) {
    const j = res.status === 'fulfilled' ? res.value : null
    return Array.isArray(j?.pairs) ? j.pairs[0] : j?.pair ?? null
  }

  const eth  = pair(ethRes)
  const base = pair(baseRes)
  const sol  = pair(solRes)

  const price  = parseFloat(eth?.priceUsd ?? 0)
  const mcap   = price * CIRC_SUPPLY
  const vol24  = (parseFloat(eth?.volume?.h24 ?? 0) + parseFloat(base?.volume?.h24 ?? 0) + parseFloat(sol?.volume?.h24 ?? 0))
  const liqEth  = parseFloat(eth?.liquidity?.usd ?? 0)
  const liqBase = parseFloat(base?.liquidity?.usd ?? 0)
  const liqSol  = parseFloat(sol?.liquidity?.usd ?? 0)
  const change24 = parseFloat(eth?.priceChange?.h24 ?? 0)

  return { price, mcap, vol24, liqEth, liqBase, liqSol, change24 }
}

function Stat({ label, value, sub, accent }) {
  return (
    <div className={styles.stat}>
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statValue} style={accent ? { color: accent } : undefined}>{value}</div>
      {sub && <div className={styles.statSub}>{sub}</div>}
    </div>
  )
}

export default function SnapshotModal({ onClose }) {
  const [stats, setStats]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const cardRef               = useRef(null)

  useEffect(() => {
    fetchStats().then(s => { setStats(s); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  const download = useCallback(async () => {
    if (!cardRef.current) return
    setSaving(true)
    try {
      const canvas = await html2canvas(cardRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: null,
        logging: false,
      })
      const link = document.createElement('a')
      link.download = `kendu-${Date.now()}.png`
      link.href = canvas.toDataURL('image/png')
      link.click()
    } finally {
      setSaving(false)
    }
  }, [])

  const now = new Date()
  const dateStr = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).toUpperCase()

  const changeColor = stats?.change24 >= 0 ? '#24c65b' : '#B63733'
  const changeSign  = stats?.change24 >= 0 ? '+' : ''

  return (
    <div className={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>
        <div className={styles.modalHead}>
          <span className={styles.modalTitle}>SNAPSHOT</span>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        {/* The card that gets captured */}
        <div ref={cardRef} className={styles.card}>
          <div className={styles.cardBg} />

          <div className={styles.cardHeader}>
            <img src="/kendu-mask.png" alt="Kendu" className={styles.cardLogo} />
            <div className={styles.cardBrand}>
              <span className={styles.cardBrandName}>KENDU</span>
              <span className={styles.cardBrandSub}>DASHBOARD</span>
            </div>
            <div className={styles.cardDate}>{dateStr}</div>
          </div>

          {loading ? (
            <div className={styles.loadingMsg}>Loading stats…</div>
          ) : stats ? (
            <>
              <div className={styles.priceRow}>
                <span className={styles.priceLabel}>PRICE</span>
                <span className={styles.priceValue}>{stats.price > 0 ? '$' + stats.price.toFixed(8) : '—'}</span>
                <span className={styles.priceChange} style={{ color: changeColor }}>
                  {changeSign}{stats.change24.toFixed(2)}% 24H
                </span>
              </div>

              <div className={styles.statsGrid}>
                <Stat label="MARKET CAP"     value={stats.mcap   > 0 ? fmtUSD(stats.mcap)   : '—'} />
                <Stat label="24H VOLUME"     value={stats.vol24  > 0 ? fmtUSD(stats.vol24)  : '—'} sub="ALL CHAINS" />
                <Stat label="ETH LIQUIDITY"  value={stats.liqEth  > 0 ? fmtUSD(stats.liqEth)  : '—'} />
                <Stat label="BASE LIQUIDITY" value={stats.liqBase > 0 ? fmtUSD(stats.liqBase) : '—'} />
                <Stat label="SOL LIQUIDITY"  value={stats.liqSol  > 0 ? fmtUSD(stats.liqSol)  : '—'} />
                <Stat label="CIRC. SUPPLY"   value={fmtNum(CIRC_SUPPLY)} />
              </div>
            </>
          ) : (
            <div className={styles.loadingMsg}>Failed to load stats.</div>
          )}

          <div className={styles.cardFooter}>
            <span className={styles.cardUrl}>kendu.io</span>
            <span className={styles.cardTag}>#KENDU · #HIGHERDOG</span>
          </div>
        </div>

        <div className={styles.actions}>
          <button className="k-btn" onClick={download} disabled={saving || loading}>
            {saving ? 'Saving…' : '⬇ Download PNG'}
          </button>
        </div>
      </div>
    </div>
  )
}
