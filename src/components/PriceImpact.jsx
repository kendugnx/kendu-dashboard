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
// Returns { newMC, pctChange, priceMultiplier }
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

// Given a desired price multiplier, find the trade size that produces it on a given pool
function tradeForMultiplier(liquidityUSD, multiplier, isBuy) {
  if (!isFinite(liquidityUSD) || liquidityUSD <= 0) return NaN
  if (!isFinite(multiplier) || multiplier <= 0) return NaN
  const quoteReserve = liquidityUSD / 2
  if (isBuy) {
    // multiplier = ((q + trade) / q)^2  →  trade = q * (sqrt(multiplier) - 1)
    return quoteReserve * (Math.sqrt(multiplier) - 1)
  } else {
    // multiplier = (q / (q + trade))^2  →  trade = q * (1/sqrt(multiplier) - 1)
    return quoteReserve * (1 / Math.sqrt(multiplier) - 1)
  }
}

// Progressive: compound N trades in a row.
// useArb=true → arb restores pool depth between each trade (each buy starts fresh against
// full effective liquidity, just at the new higher price); pool depletion is NOT compounded.
// useArb=false → no rebalancing between trades; pool depletes each step, so later buys hit harder.
function calcProgressive(currentMC, effLiquidityUSD, tradeUSD, isBuy, count, useArb) {
  let mc = currentMC
  let liq = effLiquidityUSD
  const baseLiq = effLiquidityUSD
  for (let i = 0; i < count; i++) {
    const res = calcImpact(mc, liq, tradeUSD, isBuy)
    if (!res) break
    mc = res.newMC
    if (useArb) {
      // Pool depth restores via arb, but scales with the new price level
      liq = baseLiq * res.multiplier
    } else {
      // Pool depletes — each subsequent trade has more impact
      liq = liq * res.multiplier
    }
  }
  const totalPct = ((mc / currentMC) - 1) * 100
  return { newMC: mc, pctChange: totalPct }
}

const CHAIN_LABELS = { eth: 'ETH', base: 'BASE', sol: 'SOL' }
const CHAIN_COLORS = { eth: 'var(--accent)', base: 'var(--accent2)', sol: 'var(--accent3)' }

export default function PriceImpact({ collapsed, onToggle }) {
  const [liquidity, setLiquidity] = useState({ eth: null, base: null, sol: null })
  const [currentMC,  setCurrentMC]  = useState(null)
  const [updatedTs,  setUpdatedTs]  = useState(null)

  // Inputs
  const [tradeInput,  setTradeInput]  = useState('')
  const [sourceChain, setSourceChain] = useState('eth')
  const [isBuy,       setIsBuy]       = useState(true)
  const [useArb,      setUseArb]      = useState(true)
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
  const tradeUSD  = parseAmount(tradeInput)
  const count     = Math.max(1, Math.min(100, parseInt(tradeCount) || 1))
  const srcLiq    = liquidity[sourceChain]
  // Arb efficiency: ETH pool is canonical and fully counts; Base + SOL provide partial
  // resistance via cross-chain arb but bridging has latency/cost, so weight at 60%.
  const ARB_EFFICIENCY = 0.6
  const arbLiq = (liquidity.eth || 0) + ((liquidity.base || 0) + (liquidity.sol || 0)) * ARB_EFFICIENCY
  const effLiq = useArb ? arbLiq : srcLiq

  // Primary impact result
  const result = isFinite(tradeUSD) && tradeUSD > 0 && effLiq > 0 && currentMC
    ? progressive
      ? calcProgressive(currentMC, effLiq, tradeUSD, isBuy, count, useArb)
      : calcImpact(currentMC, effLiq, tradeUSD, isBuy)
    : null

  // Arb ON: same $X on any chain → same global MC move (capital is capital).
  // What differs is execution slippage per pool. slippage = tradeUSD / (quoteReserve + tradeUSD)
  const chainSlippage = useArb && isFinite(tradeUSD) && tradeUSD > 0
    ? Object.fromEntries(
        Object.entries(liquidity).map(([chain, liq]) => {
          if (!liq) return [chain, null]
          const quoteReserve = liq / 2
          return [chain, (tradeUSD / (quoteReserve + tradeUSD)) * 100]
        })
      )
    : null

  // Arb OFF: isolated pools — what trade on each chain produces the same % local move?
  const singleResult = !useArb && isFinite(tradeUSD) && tradeUSD > 0 && srcLiq > 0 && currentMC
    ? calcImpact(currentMC, srcLiq, tradeUSD, isBuy)
    : null
  const equivTrades = singleResult
    ? Object.fromEntries(
        Object.entries(liquidity).map(([chain, liq]) => {
          if (!liq || chain === sourceChain) return [chain, tradeUSD]
          const equiv = tradeForMultiplier(liq, singleResult.multiplier, isBuy)
          return [chain, equiv]
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

          {/* Chain selector */}
          <div className={styles.toggleGroup}>
            {['eth','base','sol'].map(chain => (
              <button
                key={chain}
                className={`k-chip ${sourceChain === chain ? 'active' : ''}`}
                onClick={() => setSourceChain(chain)}
              >{CHAIN_LABELS[chain]}</button>
            ))}
          </div>
        </div>

        {/* Trade amount input */}
        <div className={styles.inputRow}>
          <div className={styles.inputCol}>
            <div className="k-eyebrow">Trade Size (USD)</div>
            <div className={styles.usdWrap}>
              <span className={styles.usdPrefix}>$</span>
              <input
                className={styles.input}
                placeholder="1000, 50K, 1M"
                value={tradeInput}
                onChange={e => setTradeInput(e.target.value.replace(/^\$/, ''))}
              />
            </div>
          </div>

          {/* Arb toggle */}
          <div className={styles.inputCol}>
            <div className="k-eyebrow">Arbitrage</div>
            <div className={styles.toggleGroup}>
              <button className={`k-chip ${useArb ? 'active' : ''}`} onClick={() => setUseArb(true)}>Instant</button>
              <button className={`k-chip ${!useArb ? 'active' : ''}`} onClick={() => setUseArb(false)}>None</button>
            </div>
          </div>

          {/* Progressive toggle */}
          <div className={styles.inputCol}>
            <div className="k-eyebrow">Mode</div>
            <div className={styles.toggleGroup}>
              <button className={`k-chip ${!progressive ? 'active' : ''}`} onClick={() => setProgressive(false)}>Single</button>
              <button className={`k-chip ${progressive ? 'active' : ''}`}  onClick={() => setProgressive(true)}>Progressive</button>
            </div>
          </div>

          {progressive && (
            <div className={styles.inputCol}>
              <div className="k-eyebrow">Trade Count</div>
              <input
                className={styles.input}
                placeholder="5"
                value={tradeCount}
                onChange={e => setTradeCount(e.target.value.replace(/\D/g, ''))}
                style={{ width: '80px' }}
              />
            </div>
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
              <div className={styles.resultSub}>{useArb ? 'all chains' : CHAIN_LABELS[sourceChain] + ' only'}</div>
            </div>
          </div>
        )}

        {/* Arb ON: same trade on any chain = same MC move; show per-chain execution slippage */}
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

        {/* Arb OFF: isolated pools — trade size on each chain for the same % local move */}
        {equivTrades && singleResult && (
          <div className={styles.equivSection}>
            <div className={styles.equivHeader}>
              Equivalent {fmtPctChange(singleResult.pctChange)} move — each chain in isolation (no arb)
            </div>
            <div className={styles.equivGrid}>
              {['eth','base','sol'].map(chain => (
                <div key={chain} className={styles.equivCard} style={{ '--chain-color': CHAIN_COLORS[chain] }}>
                  <div className={styles.equivChain}>{CHAIN_LABELS[chain]}</div>
                  <div className={styles.equivVal}>
                    {chain === sourceChain
                      ? fmtUSD(tradeUSD)
                      : isFinite(equivTrades[chain]) ? fmtUSD(equivTrades[chain]) : '—'}
                  </div>
                  {chain === sourceChain && <div className={styles.equivSub}>source</div>}
                  {chain !== sourceChain && liquidity[chain] != null && (
                    <div className={styles.equivSub}>liq: {fmtUSD(liquidity[chain])}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Disclaimers */}
        <div className={styles.disclaimer}>
          <div className={styles.disclaimerTitle}>Estimates only — not financial advice</div>
          <ul className={styles.disclaimerList}>
            <li>Uses constant-product (x·y=k) AMM formula. ETH liquidity is fetched directly from the Uniswap V2 pool contract for accuracy. BASE (Aerodrome) and SOL (Raydium) use reported liquidity from DexScreener.</li>
            <li>"Instant arb" weights ETH liquidity at 100% and BASE/SOL at 60% — cross-chain arb via Wormhole has bridging latency and gas cost that reduces its effectiveness.</li>
            <li>Progressive mode: with arb on, pool depth restores between each trade (at the new price level); with arb off, pool depletes each step so later buys hit harder.</li>
            <li>Liquidity snapshots are live but can change rapidly with LP adds/removes.</li>
          </ul>
        </div>

        <div className="k-foot">{fmtUpdated(updatedTs)}</div>
      </div></div>
    </div>
  )
}
