import React, { useState, useEffect, useRef, useCallback } from 'react'
import html2canvas from 'html2canvas'
import { getJSON } from '../utils/index.js'
import { API } from '../utils/apiBase.js'
import { LPS, CIRC_SUPPLY } from '../utils/constants.js'
import styles from './SnapshotModal.module.css'

const PAIR_ETH  = LPS.eth.address
const PAIR_BASE = LPS.base.address
const PAIR_SOL  = LPS.sol.address

function fmtMC(v) {
  if (!v || v <= 0) return '—'
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B'
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M'
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(2) + 'K'
  return '$' + v.toFixed(2)
}

function fmtPrice(v) {
  if (!v || v <= 0) return '—'
  if (v < 0.00001) return '$' + v.toFixed(10).replace(/0+$/, '')
  if (v < 0.001)   return '$' + v.toFixed(8).replace(/0+$/, '')
  return '$' + v.toFixed(6)
}

function fmtCompact(v) {
  if (!v || v <= 0) return '—'
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M'
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(2) + 'K'
  return '$' + v.toFixed(0)
}

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

  const price    = parseFloat(eth?.priceUsd ?? 0)
  const mcap     = price * CIRC_SUPPLY
  const change24 = parseFloat(eth?.priceChange?.h24 ?? 0)

  const volEth   = parseFloat(eth?.volume?.h24  ?? 0)
  const volBase  = parseFloat(base?.volume?.h24 ?? 0)
  const volSol   = parseFloat(sol?.volume?.h24  ?? 0)
  const volTotal = volEth + volBase + volSol

  const liqEth   = parseFloat(eth?.liquidity?.usd  ?? 0)
  const liqBase  = parseFloat(base?.liquidity?.usd ?? 0)
  const liqSol   = parseFloat(sol?.liquidity?.usd  ?? 0)
  const liqTotal = liqEth + liqBase + liqSol

  return { price, mcap, change24, volEth, volBase, volSol, volTotal, liqEth, liqBase, liqSol, liqTotal }
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
  const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase()

  const changeColor = stats?.change24 >= 0 ? '#24c65b' : '#B63733'
  const changeSign  = stats?.change24 >= 0 ? '+' : ''

  return (
    <div className={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>
        <div className={styles.modalHead}>
          <span className={styles.modalTitle}>SNAPSHOT</span>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div ref={cardRef} className={styles.card}>
          <div className={styles.cardBg} />

          {/* Date — absolute top-right */}
          <div className={styles.cardDate}>{dateStr}</div>

          <div className={styles.cardHeader}>
            <img src="/kendu-mask.png" alt="Kendu" className={styles.cardLogo} />
            <div className={styles.cardBrand}>
              <span className={styles.cardBrandName}>KENDU</span>
              <span className={styles.cardBrandSub}>DASHBOARD</span>
            </div>
          </div>

          {loading ? (
            <div className={styles.loadingMsg}>Loading stats…</div>
          ) : stats ? (
            <>
              <div className={styles.mcRow}>
                <div className={styles.mcLabel}>MARKET CAP</div>
                <div className={styles.mcValue}>{fmtMC(stats.mcap)}</div>
                <div className={styles.mcPrice}>
                  <span className={styles.mcPriceVal}>{fmtPrice(stats.price)}</span>
                  <span className={styles.mcPriceDelta} style={{ color: changeColor }}>
                    {changeSign}{stats.change24.toFixed(2)}%
                  </span>
                </div>
              </div>

              <div className={styles.chainTable}>
                <div className={styles.chainHead}>
                  <span />
                  <span>ETH</span>
                  <span>BASE</span>
                  <span>SOL</span>
                  <span>TOTAL</span>
                </div>
                <div className={styles.chainRow}>
                  <span className={styles.chainRowLabel}>24H VOLUME</span>
                  <span>{fmtCompact(stats.volEth)}</span>
                  <span>{fmtCompact(stats.volBase)}</span>
                  <span>{fmtCompact(stats.volSol)}</span>
                  <span className={styles.chainTotal}>{fmtCompact(stats.volTotal)}</span>
                </div>
                <div className={styles.chainRow}>
                  <span className={styles.chainRowLabel}>LIQUIDITY</span>
                  <span>{fmtCompact(stats.liqEth)}</span>
                  <span>{fmtCompact(stats.liqBase)}</span>
                  <span>{fmtCompact(stats.liqSol)}</span>
                  <span className={styles.chainTotal}>{fmtCompact(stats.liqTotal)}</span>
                </div>
              </div>
            </>
          ) : (
            <div className={styles.loadingMsg}>Failed to load stats.</div>
          )}

          <div className={styles.cardFooter}>
            <span className={styles.cardSlogan}>HIGHER.</span>
            <span className={styles.cardUrl}>KENDU.io</span>
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
