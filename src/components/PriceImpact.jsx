import React, { useState, useEffect, useCallback } from 'react'
import RefreshButton  from './RefreshButton.jsx'
import CollapseButton from './CollapseButton.jsx'
import { useRefresh } from '../hooks/useRefresh.js'
import { fmtUSD, fmtUpdated, parseAmount } from '../utils/index.js'
import { LPS, CIRC_SUPPLY } from '../utils/constants.js'
import { API } from '../utils/apiBase.js'
import styles from './PriceImpact.module.css'

// ---- Fetch actual Uniswap V2 reserves via serverless proxy ----
async function fetchV2LiquidityUSD(poolAddress) {
  const r = await fetch(`/api/reserves?pool=${poolAddress}`)
  const j = await r.json()
  return j.liquidityUSD ?? null
}

// ---- AMM math (constant-product v2 approximation) ----
// Returns { newMC, pctChange, multiplier }
function calcImpact(currentMC, liquidityUSD, tradeUSD, isBuy) {
  if (!isFinite(currentMC) || currentMC <= 0) return null
  if (!isFinite(liquidityUSD) || liquidityUSD <= 0) return null
  if (!isFinite(tradeUSD) || tradeUSD <= 0) return null
  const quoteReserve = liquidityUSD / 2
  const multiplier = isBuy
    ? Math.pow((quoteReserve + tradeUSD) / quoteReserve, 2)
    : Math.pow(quoteReserve / (quoteReserve + tradeUSD), 2)
  const newMC = currentMC * multiplier
  const pctChange = (multiplier - 1) * 100
  return { newMC, pctChange, multiplier }
}

// Progressive: compound N trades in a row.
// After each trade, LP depth updates correctly: a buy adds 2×tradeUSD to pool value
// (buyer's ETH enters the pool; both sides remain equal in USD under x·y=k).
function calcProgressive(currentMC, effLiquidityUSD, tradeUSD, isBuy, count) {
  let mc = currentMC
  let liq = effLiquidityUSD
  for (let i = 0; i < count; i++) {
    const res = calcImpact(mc, liq, tradeUSD, isBuy)
    if (!res) break
    mc = res.newMC
    liq = isBuy ? liq + 2 * tradeUSD : Math.max(0, liq - 2 * tradeUSD)
  }
  const totalPct = ((mc / currentMC) - 1) * 100
  return { newMC: mc, pctChange: totalPct }
}

const CHAIN_LABELS = { eth: 'ETH', base: 'BASE', sol: 'SOL' }
const CHAIN_COLORS = { eth: 'var(--accent)', base: 'var(--accent2)', sol: 'var(--accent3)' }

// ETH pool is canonical and fully counts; Base + SOL provide partial resistance via
// cross-chain arb but Wormhole bridging has latency/cost, so weight at 60%.
const ARB_EFFICIENCY = 0.6

export default function PriceImpact({ collapsed, onToggle }) {
  const [liquidity, setLiquidity] = useState({ eth: null, base: null, sol: null })
  const [currentMC,  setCurrentMC]  = useState(null)
  const [updatedTs,  setUpdatedTs]  = useState(null)

  // Inputs
  const [tradeInput,  setTradeInput]  = useState('')
  const [sourceChain, setSourceChain] = useState('eth')
  const [isBuy,       setIsBuy]       = useState(true)
  const [progressive, setProgressive] = useState(false)
  const [tradeCount,  setTradeCount]  = useState('5')

  const fetchLiquidity = useCallback(async () => {
    const CHAIN_NAMES = { eth: 'ethereum', base: 'base', sol: 'solana' }

    const [dexResults, onChainLiq] = await Promise.all([
      Promise.allSettled(
        Object.entries(LPS).map(async ([chain, lp]) => {
          const url = API.dex(`/latest/dex/pairs/${CHAIN_NAMES[chain]}/${lp.address}`)
          const r = await fetch(url, { cache: 'no-store' })
          const j = await r.json()
          const pair = j?.pairs?.[0] || j?.pair
          return { chain, liq: Number(pair?.liquidity?.usd || 0), mc: Number(pair?.marketCap || 0) }
        })
      ),
      fetchV2LiquidityUSD(LPS.eth.address).catch(() => null),
    ])

    const liqMap = { eth: null, base: null, sol: null }
    let bestMC = null
    for (const res of dexResults) {
      if (res.status === 'fulfilled') {
        const { chain, liq, mc } = res.value
        if (isFinite(liq) && liq > 0) liqMap[chain] = liq
        if (isFinite(mc) && mc > 0 && (!bestMC || chain === 'eth')) bestMC = mc
      }
    }

    // Override ETH with on-chain reserves
    if (onChainLiq && onChainLiq > 0) liqMap.eth = onChainLiq

    setLiquidity(liqMap)
    if (bestMC) setCurrentMC(bestMC)
    setUpdatedTs(Date.now())
  }, [])

  const { spinning, trigger } = useRefresh(fetchLiquidity)
  useEffect(() => { fetchLiquidity() }, [])

  // ---- Derived ----
  const tradeUSD = parseAmount(tradeInput)
  const count    = Math.max(1, Math.min(100, parseInt(tradeCount) || 1))
  const effLiq   = (liquidity.eth || 0) + ((liquidity.base || 0) + (liquidity.sol || 0)) * ARB_EFFICIENCY

  // Primary impact result
  const result = isFinite(tradeUSD) && tradeUSD > 0 && effLiq > 0 && currentMC
    ? progressive
      ? calcProgressive(currentMC, effLiq, tradeUSD, isBuy, count)
      : calcImpact(currentMC, effLiq, tradeUSD, isBuy)
    : null

  // Per-chain execution slippage for the same trade amount.
  // Same $X on any chain → same global MC move (capital is capital, arb equalizes).
  // What differs is how much slippage you eat on each pool.
  const chainSlippage = isFinite(tradeUSD) && tradeUSD > 0
    ? Object.fromEntries(
        Object.entries(liquidity).map(([chain, liq]) => {
          if (!liq) return [chain, null]
          const quoteReserve = liq / 2
          return [chain, (tradeUSD / (quoteReserve + tradeUSD)) * 100]
        })
      )
    : null

  const fmtPctChange = pct => {
    if (!isFinite(pct)) return '—'
    const sign = pct > 0 ? '+' : ''
    return sign + pct.toFixed(2) + '%'
  }

  return (
    <div className={`k-card ${styles.wrap}`}>
      {/* Header */}
      <div className={styles.head}>
        <div>
          <div className="k-eyebrow">AMM Simulation</div>
          <div className={styles.title}>Price Impact</div>
        </div>
        <div className="k-head-actions">
          <RefreshButton spinning={spinning} onClick={trigger} />
          <CollapseButton collapsed={collapsed} onToggle={onToggle} />
        </div>
      </div>

      <div className={`k-body${collapsed ? ' k-collapsed' : ''}`}><div className="k-body-inner">

        {/* Live pool stats */}
        <div className={styles.poolRow}>
          {['eth','base','sol'].map(chain => (
            <div key={chain} className={styles.poolCard} style={{ '--chain-color': CHAIN_COLORS[chain] }}>
              <div className={styles.poolLabel}>{CHAIN_LABELS[chain]} Liquidity</div>
              <div className={styles.poolVal}>
                {liquidity[chain] != null ? fmtUSD(liquidity[chain]) : '—'}
              </div>
            </div>
          ))}
        </div>

        {/* Controls row */}
        <div className={styles.controlsRow}>
          {/* Trade size */}
          <div className={styles.usdWrap}>
            <span className={styles.usdPrefix}>$</span>
            <input
              className={styles.input}
              placeholder="1000, 50K, 1M"
              value={tradeInput}
              onChange={e => setTradeInput(e.target.value.replace(/^\$/, ''))}
            />
          </div>

          {/* Buy / Sell */}
          <div className={styles.toggleGroup}>
            <button
              className={`k-chip ${isBuy ? 'active' : ''} ${styles.buyChip}`}
              onClick={() => setIsBuy(true)}
            >Buy</button>
            <button
              className={`k-chip ${!isBuy ? 'active' : ''} ${styles.sellChip}`}
              onClick={() => setIsBuy(false)}
            >Sell</button>
          </div>

          {/* Progressive toggle */}
          <div className={styles.toggleGroup}>
            <button className={`k-chip ${!progressive ? 'active' : ''}`} onClick={() => setProgressive(false)}>Single</button>
            <button className={`k-chip ${progressive ? 'active' : ''}`}  onClick={() => setProgressive(true)}>Progressive</button>
          </div>

          {progressive && (
            <input
              className={styles.input}
              placeholder="5"
              value={tradeCount}
              onChange={e => setTradeCount(e.target.value.replace(/\D/g, ''))}
              style={{ width: '60px' }}
            />
          )}
        </div>

        {/* Result */}
        {result && (
          <div className={styles.resultGrid}>
            <div className={styles.resultCard}>
              <div className={styles.resultLabel}>Current MC</div>
              <div className={styles.resultVal}>{fmtUSD(currentMC)}</div>
            </div>
            <div className={`${styles.resultCard} ${styles.resultMain}`}>
              <div className={styles.resultLabel}>
                New MC
                {progressive ? ` (${count}× ${isBuy ? 'buys' : 'sells'})` : ''}
              </div>
              <div className={styles.resultVal}>{fmtUSD(result.newMC)}</div>
              <div className={result.pctChange >= 0 ? 'pos' : 'neg'} style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>
                {fmtPctChange(result.pctChange)}
              </div>
            </div>
            <div className={styles.resultCard}>
              <div className={styles.resultLabel}>Effective Pool</div>
              <div className={styles.resultVal}>{fmtUSD(effLiq)}</div>
              <div className={styles.resultSub}>all chains</div>
            </div>
          </div>
        )}

        {/* Per-chain execution slippage */}
        {chainSlippage && result && (
          <div className={styles.equivSection}>
            <div className={styles.equivHeader}>
              {fmtUSD(tradeUSD)} on any chain → same {fmtPctChange(result.pctChange)} MC move — execution slippage varies by pool depth
            </div>
            <div className={styles.equivGrid}>
              {['eth','base','sol'].map(chain => {
                const slip = chainSlippage[chain]
                return (
                  <div key={chain} className={styles.equivCard} style={{ '--chain-color': CHAIN_COLORS[chain] }}>
                    <div className={styles.equivChain}>{CHAIN_LABELS[chain]}</div>
                    <div className={styles.equivVal}>
                      {slip != null ? slip.toFixed(2) + '%' : '—'}
                    </div>
                    <div className={styles.equivSub}>
                      {liquidity[chain] != null ? `liq: ${fmtUSD(liquidity[chain])}` : 'no data'}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Disclaimers */}
        <div className={styles.disclaimer}>
          <div className={styles.disclaimerTitle}>Estimates only — not financial advice</div>
          <ul className={styles.disclaimerList}>
            <li>Uses constant-product (x·y=k) AMM formula. ETH liquidity is fetched directly from the Uniswap V2 pool contract for accuracy. BASE (Aerodrome) and SOL (Raydium) use reported liquidity from DexScreener.</li>
            <li>ETH pool is weighted at 100%; BASE and SOL at 60% — cross-chain arb via Wormhole has bridging latency and gas cost that reduces their effective contribution.</li>
            <li>Progressive mode compounds trades sequentially; arb restores pool depth between each trade at the new price level.</li>
            <li>Liquidity snapshots are live but can change rapidly with LP adds/removes.</li>
          </ul>
        </div>

        <div className="k-foot">{fmtUpdated(updatedTs)}</div>
      </div></div>
    </div>
  )
}
