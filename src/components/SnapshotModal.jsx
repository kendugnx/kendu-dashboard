import React, { useState, useEffect, useRef, useCallback } from 'react'
import html2canvas from 'html2canvas'
import { getJSON, fetchCSV } from '../utils/index.js'
import { API } from '../utils/apiBase.js'
import { LPS, CIRC_SUPPLY, HOLDERS_CSV_URL } from '../utils/constants.js'
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

function parseHoldersCSV(text) {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return null
  const header  = lines[0].split(',').map(s => s.trim().toLowerCase().replace(/[^a-z0-9]/g, ''))
  const ethIdx  = header.findIndex(h => /eth/.test(h))
  const baseIdx = header.findIndex(h => /base/.test(h))
  const solIdx  = header.findIndex(h => /sol/.test(h))
  const totIdx  = header.findIndex(h => /total/.test(h))
  const last    = lines[lines.length - 1].split(',').map(s => s.trim())
  const num     = idx => idx >= 0 ? Number(last[idx]?.replace(/[^\d]/g, '') || 0) : 0
  return { eth: num(ethIdx), base: num(baseIdx), sol: num(solIdx), total: num(totIdx) }
}

async function fetchStats() {
  const cgPath = '/simple/price?ids=ethereum&vs_currencies=usd&include_24hr_change=true'

  const [ethPairRes, baseRes, solRes, cgEthRes, csvRes, cmcRes] = await Promise.allSettled([
    getJSON(API.dex(`/latest/dex/pairs/ethereum/${PAIR_ETH}`)),
    getJSON(API.dex(`/latest/dex/pairs/base/${PAIR_BASE}`)),
    getJSON(API.dex(`/latest/dex/pairs/solana/${PAIR_SOL}`)),
    getJSON(API.coingecko(cgPath)),
    fetchCSV(HOLDERS_CSV_URL),
    fetch('/api/cmc-rank').then(r => r.json()),
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

  const cgEth      = cgEthRes.status === 'fulfilled' ? cgEthRes.value : null
  const ethPrice   = cgEth?.ethereum?.usd ?? null
  const ethChange24 = cgEth?.ethereum?.usd_24h_change ?? null

  const volEth   = parseFloat(eth?.volume?.h24  ?? 0)
  const volBase  = parseFloat(base?.volume?.h24 ?? 0)
  const volSol   = parseFloat(sol?.volume?.h24  ?? 0)
  const volTotal = volEth + volBase + volSol

  const liqEth   = parseFloat(eth?.liquidity?.usd  ?? 0)
  const liqBase  = parseFloat(base?.liquidity?.usd ?? 0)
  const liqSol   = parseFloat(sol?.liquidity?.usd  ?? 0)
  const liqTotal = liqEth + liqBase + liqSol

  const holders = csvRes.status === 'fulfilled' ? parseHoldersCSV(csvRes.value) : null
  const cmcRank = cmcRes.status === 'fulfilled' ? (cmcRes.value?.rank ?? null) : null

  return { mcap, change24, ethPrice, ethChange24, volEth, volBase, volSol, volTotal, liqEth, liqBase, liqSol, liqTotal, holders, cmcRank }
}

export default function SnapshotModal({ onClose }) {
  const [stats, setStats]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const cardRef               = useRef(null)

  useEffect(() => {
    fetchStats().then(s => { setStats(s); setLoading(false) }).catch(e => { console.error('SnapshotModal fetchStats:', e); setLoading(false) })
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
                  {stats.cmcRank && (
                    <span className={styles.cmcBadge}>CMC MEME #{stats.cmcRank}</span>
                  )}
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
                {stats.holders && (
                  <div className={styles.chainRow}>
                    <span className={styles.chainRowLabel}>HOLDERS</span>
                    <span>{stats.holders.eth ? stats.holders.eth.toLocaleString() : '—'}</span>
                    <span>{stats.holders.base ? stats.holders.base.toLocaleString() : '—'}</span>
                    <span>{stats.holders.sol ? stats.holders.sol.toLocaleString() : '—'}</span>
                    <span className={styles.chainTotal}>{stats.holders.total ? stats.holders.total.toLocaleString() : '—'}</span>
                  </div>
                )}
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
