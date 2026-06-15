import React, { useState } from 'react'
import RefreshButton from './RefreshButton.jsx'
import CollapseButton from './CollapseButton.jsx'
import { fmtNum, fmtUSD } from '../utils/index.js'
import { KENDU_ETH_CA, CIRC_SUPPLY, TIER_DEFS } from '../utils/constants.js'
import styles from './WalletTracker.module.css'

function tierForTokens(tok) {
  if (!isFinite(tok) || tok <= 0) return null
  return TIER_DEFS.find(t => tok >= t.min && tok < t.max) || TIER_DEFS[TIER_DEFS.length - 1]
}

function shortAddr(addr) {
  return addr.slice(0, 6) + '…' + addr.slice(-4)
}

export default function WalletTracker({ collapsed, onToggle }) {
  const [input, setInput]     = useState('')
  const [result, setResult]   = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)

  async function lookup(addr) {
    addr = addr.trim()
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
      setError('Enter a valid Ethereum address (0x…)')
      return
    }
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const r = await fetch(
        `/api/etherscan?module=account&action=tokenbalance&contractaddress=${KENDU_ETH_CA}&address=${addr}&tag=latest`
      )
      const j = await r.json()
      if (j.status !== '1') throw new Error(j.message || 'Lookup failed')
      const rawBalance = BigInt(j.result)
      const balance = Number(rawBalance) / 1e18
      const pctSupply = (balance / CIRC_SUPPLY) * 100
      const tier = tierForTokens(balance)
      setResult({ addr, balance, pctSupply, tier })
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = e => {
    e.preventDefault()
    if (input.trim()) lookup(input)
  }

  return (
    <div className={`k-card ${styles.wrap}`}>
      <div className={styles.head}>
        <div>
          <div className="k-eyebrow">Ethereum</div>
          <div className={styles.title}>Wallet Tracker</div>
        </div>
        <div className="k-head-actions">
          {result && <RefreshButton spinning={loading} onClick={() => lookup(result.addr)} />}
          <CollapseButton collapsed={collapsed} onToggle={onToggle} />
        </div>
      </div>

      <div className={`k-body${collapsed ? ' k-collapsed' : ''}`}><div className="k-body-inner">
        <form className={styles.form} onSubmit={handleSubmit}>
          <input
            className={styles.input}
            placeholder="0x… wallet address"
            value={input}
            onChange={e => setInput(e.target.value)}
            spellCheck={false}
          />
          <button className={`k-chip active ${styles.btn}`} type="submit" disabled={loading}>
            {loading ? 'Looking up…' : 'Lookup'}
          </button>
        </form>

        {error && <div className={styles.error}>{error}</div>}

        {result && (
          <div className={styles.resultGrid}>
            <div className={styles.resultCard}>
              <div className="k-eyebrow">Address</div>
              <div className={styles.addr}>
                <a href={`https://etherscan.io/address/${result.addr}`} target="_blank" rel="noopener noreferrer">
                  {shortAddr(result.addr)}
                </a>
              </div>
            </div>
            <div className={styles.resultCard}>
              <div className="k-eyebrow">KENDU Balance</div>
              <div className={styles.bigVal}>{fmtNum(result.balance)}</div>
            </div>
            <div className={styles.resultCard}>
              <div className="k-eyebrow">% of Supply</div>
              <div className={styles.bigVal}>{result.pctSupply.toFixed(4)}%</div>
            </div>
            <div className={`${styles.resultCard} ${styles.tierCard}`}>
              <div className="k-eyebrow">Tier</div>
              <div className={styles.tierName}>{result.tier?.name ?? '—'}</div>
              {result.tier && (
                <div className={styles.tierRange}>
                  {fmtNum(result.tier.min)} – {result.tier.max === Infinity ? '∞' : fmtNum(result.tier.max)}
                </div>
              )}
            </div>
          </div>
        )}
        {!result && !error && !loading && (
          <div className={styles.empty}>Enter any Ethereum wallet address to see their KENDU position.</div>
        )}
      </div></div>
    </div>
  )
}
