import React, { useState, useEffect, useRef, useCallback } from 'react'
import html2canvas from 'html2canvas'
import { getJSON, fetchCSV } from '../utils/index.js'
import { API } from '../utils/apiBase.js'
import { LPS, CIRC_SUPPLY, HOLDERS_CSV_URL } from '../utils/constants.js'
import styles from './SnapshotModal.module.css'

const PAIR_ETH  = LPS.eth.address
const PAIR_BASE = LPS.base.address
const PAIR_SOL  = LPS.sol.address

// GeckoTerminal pool address mirrors LPS.eth.address
const GT_POOL_ETH = LPS.eth.address

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
  const [ethPairRes, baseRes, solRes, csvRes, cmcRes, tradesRes] = await Promise.allSettled([
    getJSON(API.dex(`/latest/dex/pairs/ethereum/${PAIR_ETH}`)),
    getJSON(API.dex(`/latest/dex/pairs/base/${PAIR_BASE}`)),
    getJSON(API.dex(`/latest/dex/pairs/solana/${PAIR_SOL}`)),
    fetchCSV(HOLDERS_CSV_URL),
    fetch('/api/cmc-rank').then(r => r.json()),
    fetch(`https://api.geckoterminal.com/api/v2/networks/eth/pools/${GT_POOL_ETH}/trades?limit=300`)
      .then(r => r.json()),
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

  const volEth   = parseFloat(eth?.volume?.h24  ?? 0)
  const volBase  = parseFloat(base?.volume?.h24 ?? 0)
  const volSol   = parseFloat(sol?.volume?.h24  ?? 0)
  const volTotal = volEth + volBase + volSol

  const liqEth   = parseFloat(eth?.liquidity?.usd  ?? 0)
  const liqBase  = parseFloat(base?.liquidity?.usd ?? 0)
  const liqSol   = parseFloat(sol?.liquidity?.usd  ?? 0)
  const liqTotal = liqEth + liqBase + liqSol

  // Buy/sell counts from DEXScreener txns (aggregate all chains)
  const txEth  = eth?.txns?.h24  ?? {}
  const txBase = base?.txns?.h24 ?? {}
  const txSol  = sol?.txns?.h24  ?? {}
  const buys   = (txEth.buys  ?? 0) + (txBase.buys  ?? 0) + (txSol.buys  ?? 0)
  const sells  = (txEth.sells ?? 0) + (txBase.sells ?? 0) + (txSol.sells ?? 0)

  // Largest buy/sell from GeckoTerminal recent trades
  let largestBuy  = 0
  let largestSell = 0
  if (tradesRes.status === 'fulfilled') {
    const trades = tradesRes.value?.data ?? []
    for (const t of trades) {
      const usd  = parseFloat(t.attributes?.volume_in_usd ?? 0)
      const kind = t.attributes?.kind
      if (kind === 'buy'  && usd > largestBuy)  largestBuy  = usd
      if (kind === 'sell' && usd > largestSell) largestSell = usd
    }
  }

  const holders = csvRes.status === 'fulfilled' ? parseHoldersCSV(csvRes.value) : null
  const cmcData = cmcRes.status === 'fulfilled' ? cmcRes.value : {}
  const cmcRank  = cmcData?.rank     ?? null
  const memeRank = cmcData?.memeRank ?? null

  return {
    mcap, change24,
    volEth, volBase, volSol, volTotal,
    liqEth, liqBase, liqSol, liqTotal,
    holders,
    buys, sells,
    largestBuy, largestSell,
    cmcRank, memeRank,
  }
}

export default function SnapshotModal({ onClose }) {
  const [stats, setStats]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [sharing, setSharing] = useState(false)
  const cardRef               = useRef(null)
  const canShare              = typeof navigator !== 'undefined' && !!navigator.share

  useEffect(() => {
    fetchStats()
      .then(s => { setStats(s); setLoading(false) })
      .catch(e => { console.error('SnapshotModal fetchStats:', e); setLoading(false) })
  }, [])

  const renderCanvas = useCallback(() =>
    html2canvas(cardRef.current, { scale: 2, useCORS: true, backgroundColor: null, logging: false }),
  [])

  const download = useCallback(async () => {
    if (!cardRef.current) return
    setSaving(true)
    try {
      const canvas = await renderCanvas()
      const link = document.createElement('a')
      link.download = `kendu-${Date.now()}.png`
      link.href = canvas.toDataURL('image/png')
      link.click()
    } finally {
      setSaving(false)
    }
  }, [renderCanvas])

  const share = useCallback(async () => {
    if (!cardRef.current) return
    setSharing(true)
    try {
      const canvas = await renderCanvas()
      canvas.toBlob(async blob => {
        try {
          const file = new File([blob], 'kendu-snapshot.png', { type: 'image/png' })
          if (navigator.canShare?.({ files: [file] })) {
            await navigator.share({ files: [file], title: 'KENDU Snapshot' })
          } else {
            // Fallback: share URL only
            await navigator.share({ title: 'KENDU Snapshot', url: window.location.href })
          }
        } catch (e) {
          if (e.name !== 'AbortError') console.error('share failed:', e)
        } finally {
          setSharing(false)
        }
      }, 'image/png')
    } catch (e) {
      console.error('share render failed:', e)
      setSharing(false)
    }
  }, [renderCanvas])

  const now = new Date()
  const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase()

  const changeColor = stats?.change24 >= 0 ? '#24c65b' : '#B63733'
  const changeSign  = stats?.change24 >= 0 ? '+' : ''
  const ratio       = stats && stats.sells > 0 ? (stats.buys / stats.sells).toFixed(2) : null

  return (
    <div className={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>
        <div className={styles.modalHead}>
          <span className={styles.modalTitle}>SNAPSHOT</span>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div ref={cardRef} className={styles.card}>
          <div className={styles.cardBg} />

          {/* ---- Header ---- */}
          <div className={styles.cardHeader}>
            <img src="/kendu-mask.png" alt="Kendu" className={styles.cardLogo} />
            <div className={styles.cardBrand}>
              <span className={styles.cardBrandName}>KENDU</span>
              <span className={styles.cardBrandSub}>DASHBOARD</span>
            </div>
            <div className={styles.cardMeta}>
              <span className={styles.cardDate}>{dateStr}</span>
              {stats?.cmcRank  && <span className={styles.cmcBadge}>CMC #{stats.cmcRank}</span>}
              {stats?.memeRank && <span className={styles.cmcBadge}>MEME #{stats.memeRank}</span>}
            </div>
          </div>

          {loading ? (
            <div className={styles.loadingMsg}>Loading stats…</div>
          ) : stats ? (
            <>
              {/* ---- MC hero ---- */}
              <div className={styles.mcBlock}>
                <span className={styles.mcLabel}>KENDU MC</span>
                <div className={styles.mcRow}>
                  <span className={styles.mcValue}>{fmtMC(stats.mcap)}</span>
                  <span className={styles.mcDelta} style={{ color: changeColor }}>
                    {changeSign}{stats.change24.toFixed(2)}%
                  </span>
                </div>
              </div>

              {/* ---- Chain table ---- */}
              <div className={styles.chainTable}>
                <div className={styles.chainHead}>
                  <span />
                  <span>ETH</span>
                  <span>BASE</span>
                  <span>SOL</span>
                  <span className={styles.chainHeadTotal}>TOTAL</span>
                </div>
                <div className={styles.chainRow}>
                  <span className={styles.chainLabel}>24H VOL</span>
                  <span>{fmtCompact(stats.volEth)}</span>
                  <span>{fmtCompact(stats.volBase)}</span>
                  <span>{fmtCompact(stats.volSol)}</span>
                  <span className={styles.chainTotal}>{fmtCompact(stats.volTotal)}</span>
                </div>
                <div className={styles.chainRow}>
                  <span className={styles.chainLabel}>LIQUIDITY</span>
                  <span>{fmtCompact(stats.liqEth)}</span>
                  <span>{fmtCompact(stats.liqBase)}</span>
                  <span>{fmtCompact(stats.liqSol)}</span>
                  <span className={styles.chainTotal}>{fmtCompact(stats.liqTotal)}</span>
                </div>
                {stats.holders && (
                  <div className={styles.chainRow}>
                    <span className={styles.chainLabel}>HOLDERS</span>
                    <span>{stats.holders.eth ? stats.holders.eth.toLocaleString() : '—'}</span>
                    <span>{stats.holders.base ? stats.holders.base.toLocaleString() : '—'}</span>
                    <span>{stats.holders.sol ? stats.holders.sol.toLocaleString() : '—'}</span>
                    <span className={styles.chainTotal}>{stats.holders.total ? stats.holders.total.toLocaleString() : '—'}</span>
                  </div>
                )}
              </div>

              {/* ---- Activity ---- */}
              {(stats.buys > 0 || stats.largestBuy > 0) && (
                <div className={styles.activity}>
                  <div className={styles.activityRow}>
                    {/* Left: buys */}
                    <div className={styles.activityCol}>
                      <span className={styles.activityLabel}>BUYS</span>
                      <span className={styles.activityVal} style={{ color: '#24c65b' }}>
                        {stats.buys.toLocaleString()}
                      </span>
                      {stats.largestBuy > 0 && <>
                        <span className={styles.activitySubLabel}>LARGEST BUY</span>
                        <span className={styles.activitySubVal} style={{ color: '#24c65b' }}>
                          {fmtCompact(stats.largestBuy)}
                        </span>
                      </>}
                    </div>
                    {/* Center: ratio */}
                    {ratio && (
                      <div className={styles.activityColCenter}>
                        <span className={styles.activityLabel}>RATIO</span>
                        <span className={styles.activityVal}>{ratio}×</span>
                      </div>
                    )}
                    {/* Right: sells */}
                    <div className={styles.activityColRight}>
                      <span className={styles.activityLabel}>SELLS</span>
                      <span className={styles.activityVal} style={{ color: '#B63733' }}>
                        {stats.sells.toLocaleString()}
                      </span>
                      {stats.largestSell > 0 && <>
                        <span className={styles.activitySubLabel}>LARGEST SELL</span>
                        <span className={styles.activitySubVal} style={{ color: '#B63733' }}>
                          {fmtCompact(stats.largestSell)}
                        </span>
                      </>}
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className={styles.loadingMsg}>Failed to load stats.</div>
          )}

          {/* ---- Footer ---- */}
          <div className={styles.cardFooter}>
            <span className={styles.cardUrl}>KENDU.io</span>
            <span className={styles.cardSlogan}>HIGHER.</span>
          </div>
        </div>

        <div className={styles.actions}>
          <button className="k-btn" onClick={download} disabled={saving || sharing || loading}>
            {saving ? 'Saving…' : '⬇ Download'}
          </button>
          {canShare && (
            <button className="k-btn" onClick={share} disabled={saving || sharing || loading}>
              {sharing ? 'Sharing…' : '↑ Share'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
