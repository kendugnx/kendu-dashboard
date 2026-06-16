import React, { useState } from 'react'
import RefreshButton from './RefreshButton.jsx'
import CollapseButton from './CollapseButton.jsx'
import { fmtNum } from '../utils/index.js'
import { KENDU_ETH_CA, CIRC_SUPPLY, TIER_DEFS } from '../utils/constants.js'
import styles from './WalletTracker.module.css'

const DEX_ROUTERS = new Set([
  '0x7a250d5630b4cf539739df2c5dacb4c659f2488d', // Uniswap V2
  '0xe592427a0aece92de3edee1f18e0157c05861564', // Uniswap V3
  '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45', // Uniswap Universal
  '0xef1c6e67703c7bd7107eed8303fbe6ec2554bf6b', // Uniswap Universal v2
  '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad', // Uniswap Universal v3
  '0x1111111254eeb25477b68fb85ed929f73a960582', // 1inch v5
  '0x111111125421ca6dc452d289314280a0f8842a65', // 1inch v6
  '0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f', // Sushiswap
  '0x00000000219ab540356cbb839cbe05303d7705fa', // DEX aggregator
  '0x6131b5fae19ea4f9d964eac0408e4408b66337b5', // KyberSwap
  '0x6352a56caadc4f1e25cd6c75970fa768a3304e64', // OpenOcean
])

function classifyTx(tx, addr) {
  const from = tx.from.toLowerCase()
  const to = tx.to.toLowerCase()
  const me = addr.toLowerCase()
  if (to === me) {
    return DEX_ROUTERS.has(from) ? 'Buy' : 'Transfer In'
  }
  if (from === me) {
    return DEX_ROUTERS.has(to) ? 'Sell' : 'Transfer Out'
  }
  return 'Unknown'
}

function tierForTokens(tok) {
  if (!isFinite(tok) || tok <= 0) return null
  return TIER_DEFS.find(t => tok >= t.min && tok < t.max) || TIER_DEFS[TIER_DEFS.length - 1]
}

function fmtDate(ts) {
  const d = new Date(parseInt(ts) * 1000)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })
}

function shortAddr(addr) {
  return addr.slice(0, 6) + '…' + addr.slice(-4)
}

export default function WalletTracker({ collapsed, onToggle }) {
  const [input, setInput]       = useState('')
  const [result, setResult]     = useState(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)
  const [txOpen, setTxOpen]     = useState(false)

  async function lookup(addr) {
    addr = addr.trim()
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
      setError('Enter a valid Ethereum address (0x…)')
      return
    }
    setLoading(true)
    setError(null)
    setResult(null)
    setTxOpen(false)
    try {
      const [balRes, holdersRes, txRes] = await Promise.all([
        fetch(`/api/etherscan?module=account&action=tokenbalance&contractaddress=${KENDU_ETH_CA}&address=${addr}&tag=latest`),
        fetch('/api/holders?limit=100'),
        fetch(`/api/etherscan?module=account&action=tokentx&contractaddress=${KENDU_ETH_CA}&address=${addr}&sort=desc&offset=50&page=1`),
      ])

      const j = await balRes.json()
      if (j.status !== '1') throw new Error(j.message || 'Lookup failed')
      const balance = Number(BigInt(j.result)) / 1e18
      const pctSupply = (balance / CIRC_SUPPLY) * 100
      const tier = tierForTokens(balance)

      const holders = await holdersRes.json().catch(() => [])
      const rankIdx = Array.isArray(holders)
        ? holders.findIndex(h => h.address.toLowerCase() === addr.toLowerCase())
        : -1
      const rank = rankIdx >= 0 ? rankIdx + 1 : null

      const txJson = await txRes.json().catch(() => null)
      const txs = (txJson?.status === '1' && Array.isArray(txJson.result))
        ? txJson.result.map(tx => ({
            hash: tx.hash,
            ts: tx.timeStamp,
            type: classifyTx(tx, addr),
            amount: Number(BigInt(tx.value)) / 1e18,
            counterparty: tx.to.toLowerCase() === addr.toLowerCase() ? tx.from : tx.to,
          }))
        : []

      setResult({ addr, balance, pctSupply, tier, rank, txs })
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
          <div className={styles.title}>WALLET TRACKER</div>
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
          {result ? (
            <button className={`k-chip ${styles.btn}`} type="button" onClick={() => { setResult(null); setInput(''); setTxOpen(false) }}>
              Clear
            </button>
          ) : (
            <button className={`k-chip active ${styles.btn}`} type="submit" disabled={loading}>
              {loading ? 'Looking up…' : 'Lookup'}
            </button>
          )}
        </form>

        {error && <div className={styles.error}>{error}</div>}

        {result && (<>
          <div className={styles.resultGrid}>
            <div className={styles.resultCard}>
              <div className="k-eyebrow">KENDU Balance</div>
              <div className={styles.bigVal}>{fmtNum(result.balance)}</div>
            </div>
            <div className={styles.resultCard}>
              <div className="k-eyebrow">% of Supply</div>
              <div className={styles.bigVal}>{result.pctSupply.toFixed(4)}%</div>
            </div>
            <div className={styles.resultCard}>
              <div className="k-eyebrow">Holder Rank</div>
              <div className={styles.bigVal}>
                {result.rank ? `#${result.rank}` : <span style={{ color: 'var(--muted)', fontSize: 14 }}>Not in top 100</span>}
              </div>
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

          <div className={styles.txSection}>
            <button className={styles.txToggle} onClick={() => setTxOpen(o => !o)}>
              <span className={`${styles.txChevron}${txOpen ? ` ${styles.txChevronOpen}` : ''}`}>▶</span>
              Transaction History {result.txs.length > 0 && `(${result.txs.length})`}
            </button>
            <div className={`${styles.txBody}${txOpen ? '' : ` ${styles.txBodyCollapsed}`}`}>
              <div className={styles.txInner}>
                {result.txs.length === 0 ? (
                  <div className={styles.empty} style={{ paddingTop: 8 }}>No KENDU transactions found.</div>
                ) : (
                  <div className={styles.txList}>
                    <div className={styles.txHeader}>
                      <span>Date</span>
                      <span>Type</span>
                      <span>Amount</span>
                      <span>Counterparty</span>
                    </div>
                    {result.txs.map(tx => {
                      const typeKey = 'txRow' + tx.type.replace(/\s/g, '')
                      return (
                        <a
                          key={tx.hash}
                          className={`${styles.txRow} ${styles[typeKey] || ''}`}
                          href={`https://etherscan.io/tx/${tx.hash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <span className={styles.txDate}>{fmtDate(tx.ts)}</span>
                          <span className={styles.txType}>{tx.type}</span>
                          <span className={styles.txAmount}>{fmtNum(tx.amount)}</span>
                          <span className={styles.txAddr}>{shortAddr(tx.counterparty)}</span>
                        </a>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </>)}

        {!result && !error && !loading && (
          <div className={styles.empty}>Enter any Ethereum wallet address to see their KENDU position.</div>
        )}
      </div></div>
    </div>
  )
}
