import React, { useState, useEffect, useCallback } from 'react'
import RefreshButton  from './RefreshButton.jsx'
import CollapseButton from './CollapseButton.jsx'
import { useRefresh } from '../hooks/useRefresh.js'
import { fmtUSD, fmtUpdated, parseAmount } from '../utils/index.js'
import { LPS, CIRC_SUPPLY } from '../utils/constants.js'
import { API } from '../utils/apiBase.js'
import styles from './PriceImpact.module.css'

async function fetchV2LiquidityUSD(poolAddress) {
  const r = await fetch(`/api/reserves?pool=${poolAddress}`)
  const j = await r.json()
  return j.liquidityUSD ?? null
}

// MC impact via constant-product AMM on combined effective liquidity
function calcMCImpact(currentMC, effLiq, tradeUSD, isBuy) {
  if (!isFinite(currentMC) || currentMC <= 0) return null
  if (!isFinite(effLiq)    || effLiq    <= 0) return null
  if (!isFinite(tradeUSD)  || tradeUSD  <= 0) return null
  const q = effLiq / 2
  const mult = isBuy
    ? Math.pow((q + tradeUSD) / q, 2)
    : Math.pow(q / (q + tradeUSD), 2)
  return { newMC: currentMC * mult, pctChange: (mult - 1) * 100 }
}

// Tokens received from a single buy/sell on a chain's pool via x·y=k
function calcTokensReceived(chainLiq, priceUSD, tradeUSD) {
  if (!chainLiq || !priceUSD || !tradeUSD) return null
  const q  = chainLiq / 2
  const x0 = q / priceUSD
  return x0 - (x0 * q) / (q + tradeUSD)
}

// Buy volume required to move MC from current to target
function calcRequiredBuy(currentMC, effLiq, targetMC) {
  if (!isFinite(targetMC) || targetMC <= currentMC || !effLiq) return null
  return (effLiq / 2) * (Math.sqrt(targetMC / currentMC) - 1)
}

function fmtTokens(n) {
  if (!isFinite(n) || n <= 0) return '—'
  if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T'
  if (n >= 1e9)  return (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e6)  return (n / 1e6).toFixed(2) + 'M'
  return n.toFixed(0)
}

function fmtPct(pct) {
  if (!isFinite(pct)) return '—'
  return (pct > 0 ? '+' : '') + pct.toFixed(2) + '%'
}

const CHAIN_LABELS = { eth: 'ETH', base: 'BASE', sol: 'SOL' }
const CHAIN_COLORS = { eth: 'var(--accent)', base: 'var(--accent2)', sol: 'var(--accent3)' }
const ARB_EFFICIENCY = 0.6

export default function PriceImpact({ collapsed, onToggle }) {
  const [liquidity, setLiquidity] = useState({ eth: null, base: null, sol: null })
  const [currentMC, setCurrentMC] = useState(null)
  const [updatedTs, setUpdatedTs] = useState(null)

  const [tradeInput,  setTradeInput]  = useState('')
  const [isBuy,       setIsBuy]       = useState(true)
  const [targetInput, setTargetInput] = useState('')

  const fetchLiquidity = useCallback(async () => {
    const CHAIN_NAMES = { eth: 'ethereum', base: 'base', sol: 'solana' }
    const [dexResults, onChainLiq] = await Promise.all([
      Promise.allSettled(
        Object.entries(LPS).map(async ([chain, lp]) => {
          const url = API.dex(`/latest/dex/pairs/${CHAIN_NAMES[chain]}/${lp.address}`)
          const r   = await fetch(url, { cache: 'no-store' })
          const j   = await r.json()
          const pair = j?.pairs?.[0] || j?.pair
          return { chain, liq: Number(pair?.liquidity?.usd || 0), mc: Number(pair?.marketCap || 0) }
        })
      ),
      fetchV2LiquidityUSD(LPS.eth.address).catch(() => null),
    ])

    const liqMap = { eth: null, base: null, sol: null }
    let bestMC = null
    for (const res of dexResults) {
      if (res.status !== 'fulfilled') continue
      const { chain, liq, mc } = res.value
      if (isFinite(liq) && liq > 0) liqMap[chain] = liq
      if (isFinite(mc)  && mc  > 0 && (!bestMC || chain === 'eth')) bestMC = mc
    }
    if (onChainLiq && onChainLiq > 0) liqMap.eth = onChainLiq
    setLiquidity(liqMap)
    if (bestMC) setCurrentMC(bestMC)
    setUpdatedTs(Date.now())
  }, [])

  const { spinning, trigger } = useRefresh(fetchLiquidity)
  useEffect(() => { fetchLiquidity() }, [])

  // ---- Derived ----
  const tradeUSD = parseAmount(tradeInput)
  const targetMC = parseAmount(targetInput)
  const effLiq   = (liquidity.eth || 0) + ((liquidity.base || 0) + (liquidity.sol || 0)) * ARB_EFFICIENCY
  const price    = currentMC ? currentMC / CIRC_SUPPLY : null

  const mcResult = isFinite(tradeUSD) && tradeUSD > 0 && effLiq > 0 && currentMC
    ? calcMCImpact(currentMC, effLiq, tradeUSD, isBuy)
    : null

  const tokenResults = isFinite(tradeUSD) && tradeUSD > 0 && price
    ? Object.fromEntries(['eth','base','sol'].map(chain => {
        const liq = liquidity[chain]
        return [chain, liq ? calcTokensReceived(liq, price, tradeUSD) : null]
      }))
    : null

  const requiredBuy = isFinite(targetMC) && targetMC > 0
    ? calcRequiredBuy(currentMC, effLiq, targetMC)
    : null

  return (
    <div className={`k-card ${styles.wrap}`}>
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

        {/* Pool liquidity */}
        <div className={styles.poolRow}>
          {['eth','base','sol'].map(chain => (
            <div key={chain} className={styles.poolCard} style={{ '--chain-color': CHAIN_COLORS[chain] }}>
              <div className={styles.poolLabel}>{CHAIN_LABELS[chain]} Liquidity</div>
              <div className={styles.poolVal}>{liquidity[chain] != null ? fmtUSD(liquidity[chain]) : '—'}</div>
            </div>
          ))}
        </div>

        {/* Trade input */}
        <div className={styles.controlsRow}>
          <div className={styles.usdWrap}>
            <span className={styles.usdPrefix}>$</span>
            <input
              className={styles.input}
              placeholder="1000, 50K, 1M"
              value={tradeInput}
              onChange={e => setTradeInput(e.target.value.replace(/^\$/, ''))}
            />
          </div>
          <div className={styles.toggleGroup}>
            <button className={`k-chip ${isBuy  ? 'active' : ''} ${styles.buyChip}`}  onClick={() => setIsBuy(true)}>Buy</button>
            <button className={`k-chip ${!isBuy ? 'active' : ''} ${styles.sellChip}`} onClick={() => setIsBuy(false)}>Sell</button>
          </div>
        </div>

        {/* MC impact */}
        {mcResult && (
          <div className={styles.resultGrid}>
            <div className={styles.resultCard}>
              <div className={styles.resultLabel}>Current MC</div>
              <div className={styles.resultVal}>{fmtUSD(currentMC)}</div>
            </div>
            <div className={`${styles.resultCard} ${styles.resultMain}`}>
              <div className={styles.resultLabel}>New MC</div>
              <div className={styles.resultVal}>{fmtUSD(mcResult.newMC)}</div>
              <div className={mcResult.pctChange >= 0 ? 'pos' : 'neg'} style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>
                {fmtPct(mcResult.pctChange)}
              </div>
            </div>
            <div className={styles.resultCard}>
              <div className={styles.resultLabel}>Trade Size</div>
              <div className={styles.resultVal}>{fmtUSD(tradeUSD)}</div>
            </div>
          </div>
        )}

        {/* Tokens received per chain */}
        {tokenResults && (
          <div className={styles.equivSection}>
            <div className={styles.equivHeader}>Tokens received per chain</div>
            <div className={styles.equivGrid}>
              {['eth','base','sol'].map(chain => (
                <div key={chain} className={styles.equivCard} style={{ '--chain-color': CHAIN_COLORS[chain] }}>
                  <div className={styles.equivChain}>{CHAIN_LABELS[chain]}</div>
                  <div className={styles.equivVal}>{fmtTokens(tokenResults[chain])}</div>
                  <div className={styles.equivSub}>kendu</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Inverse: buy volume to reach target MC */}
        <div className={styles.equivSection}>
          <div className={styles.equivHeader}>Buy volume to reach target MC</div>
          <div className={styles.controlsRow}>
            <div className={styles.usdWrap}>
              <span className={styles.usdPrefix}>$</span>
              <input
                className={styles.input}
                placeholder="100M, 1B, 5B"
                value={targetInput}
                onChange={e => setTargetInput(e.target.value.replace(/^\$/, ''))}
              />
            </div>
            {requiredBuy != null && (
              <div className={styles.resultCard} style={{ flex: 1 }}>
                <div className={styles.resultLabel}>Required Buy</div>
                <div className={styles.resultVal}>{fmtUSD(requiredBuy)}</div>
                <div className={styles.resultSub}>to reach {fmtUSD(targetMC)}</div>
              </div>
            )}
            {isFinite(targetMC) && targetMC > 0 && targetMC <= currentMC && (
              <div className={styles.resultSub} style={{ alignSelf: 'center' }}>
                Target must be above current MC
              </div>
            )}
          </div>
        </div>

        {/* Disclaimer */}
        <div className={styles.disclaimer}>
          <div className={styles.disclaimerTitle}>Estimates only — not financial advice</div>
          <ul className={styles.disclaimerList}>
            <li>Uses constant-product (x·y=k) AMM formula. ETH liquidity is fetched from the Uniswap V2 pool contract on-chain. BASE and SOL use DexScreener reported liquidity.</li>
            <li>MC impact uses combined effective liquidity: ETH at 100%, BASE and SOL at 60% — Wormhole bridging latency reduces their arb contribution.</li>
            <li>Tokens received are calculated per chain using that chain's pool depth independently.</li>
          </ul>
        </div>

        <div className="k-foot">{fmtUpdated(updatedTs)}</div>
      </div></div>
    </div>
  )
}
