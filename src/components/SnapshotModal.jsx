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

function fmtCompact(v) {
  if (!v || v <= 0) return '—'
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M'
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(2) + 'K'
  return '$' + v.toFixed(0)
}

async function fetchStats() {
  const [ethPairRes, baseRes, solRes, cgEthRes, holdersRes] = await Promise.allSettled([
    getJSON(API.dex(`/latest/dex/pairs/ethereum/${PAIR_ETH}`)),
    getJSON(API.dex(`/latest/dex/pairs/base/${PAIR_BASE}`)),
    getJSON(API.dex(`/latest/dex/pairs/solana/${PAIR_SOL}`)),
    fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd&include_24hr_change=true').then(r => r.json()),
    fetch(`https://api.ethplorer.io/getTokenInfo/${KENDU_ETH_CA}?apiKey=freekey`).then(r => r.json()),
  ])

  function pair(res) {
    const j = res.status === 'fulfilled' ? res.value : null
    return Array.isArray(j?.pairs) ? j.pairs[0] : j?.pair ?? null
  }

  const eth  = pair(ethPairRes)
  const base = pair(baseRes)
  const sol  = pair(solRes)

  const kenduPrice = parseFloat(eth?.priceUsd ?? 0)
  const mcap       = kenduPrice * CIRC_SUPPLY
  const change24   = parseFloat(eth?.priceChange?.h24 ?? 0)

  const cgEth        = cgEthRes.status === 'fulfilled' ? cgEthRes.value : null
  const ethPrice     = cgEth?.ethereum?.usd ?? null
  const ethChange24  = cgEth?.ethereum?.usd_24h_change ?? null

  const volEth   = parseFloat(eth?.volume?.h24  ?? 0)
  const volBase  = parseFloat(base?.volume?.h24 ?? 0)
  const volSol   = parseFloat(sol?.volume?.h24  ?? 0)
  const volTotal = volEth + volBase + volSol

  const liqEth   = parseFloat(eth?.liquidity?.usd  ?? 0)
  const liqBase  = parseFloat(base?.liquidity?.usd ?? 0)
  const liqSol   = parseFloat(sol?.liquidity?.usd  ?? 0)
  const liqTotal = liqEth + liqBase + liqSol

  const holdersEth = holdersRes.status === 'fulfilled' ? (holdersRes.value?.holdersCount ?? null) : null

  return { mcap, change24, ethPrice, ethChange24, volEth, volBase, volSol, volTotal, liqEth, liqBase, liqSol, liqTotal, holdersEth }
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

  const changeColor   = stats?.change24 >= 0 ? '#24c65b' : '#B63733'
  const changeSign    = stats?.change24 >= 0 ? '+' : ''
  const ethChgColor   = (stats?.ethChange24 ?? 0) >= 0 ? '#24c65b' : '#B63733'
  const ethChgSign    = (stats?.ethChange24 ?? 0) >= 0 ? '+' : ''

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
                <div className={styles.mcValueRow}>
                  <span className={styles.mcValue}>{fmtMC(stats.mcap)}</span>
                  <span className={styles.mcDelta} style={{ color: changeColor }}>
                    {changeSign}{stats.change24.toFixed(2)}%
                  </span>
                </div>
                {stats.ethPrice != null && (
                  <div className={styles.ethRow}>
                    <span className={styles.ethLabel}>ETHEREUM</span>
                    <span className={styles.ethPrice}>${stats.ethPrice.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
                    {stats.ethChange24 != null && (
                      <span className={styles.ethDelta} style={{ color: ethChgColor }}>
                        {ethChgSign}{stats.ethChange24.toFixed(2)}%
                      </span>
                    )}
                  </div>
                )}
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
                <div className={styles.chainRow}>
                  <span className={styles.chainRowLabel}>HOLDERS</span>
                  <span>{stats.holdersEth ? stats.holdersEth.toLocaleString() : '—'}</span>
                  <span className={styles.muted}>—</span>
                  <span className={styles.muted}>—</span>
                  <span className={styles.chainTotal}>{stats.holdersEth ? stats.holdersEth.toLocaleString() : '—'}</span>
                </div>
              </div>
            </>
          ) : (
            <div className={styles.loadingMsg}>Failed to load stats.</div>
          )}

          <div className={styles.cardFooter}>
            <span className={styles.cardUrl}>KENDU.io</span>
            <span className={styles.cardSlogan}>HIGHER.</span>
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
