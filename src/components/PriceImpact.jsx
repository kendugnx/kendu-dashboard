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

function calcMCImpact(currentMC, effLiq, tradeUSD) {
  if (!isFinite(currentMC) || currentMC <= 0) return null
  if (!isFinite(effLiq)    || effLiq    <= 0) return null
  if (!isFinite(tradeUSD)  || tradeUSD  <= 0) return null
  const q    = effLiq / 2
  const mult = Math.pow((q + tradeUSD) / q, 2)
  return { newMC: currentMC * mult, pctChange: (mult - 1) * 100 }
}

function calcTokensReceived(chainLiq, priceUSD, tradeUSD) {
  if (!chainLiq || !priceUSD || !tradeUSD) return null
  const q  = chainLiq / 2
  const x0 = q / priceUSD
  return x0 - (x0 * q) / (q + tradeUSD)
}

function calcRequiredBuy(currentMC, effLiq, targetMC) {
  if (!isFinite(targetMC) || targetMC <= currentMC || !effLiq) return null
  return (effLiq / 2) * (Math.sqrt(targetMC / currentMC) - 1)
}

function fmtShort(n) {
  if (!isFinite(n) || n <= 0) return ''
  if (n >= 1e9) return (n / 1e9).toFixed(2).replace(/\.?0+$/, '') + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.?0+$/, '') + 'K'
  return n.toFixed(0)
}

function fmtTokens(n) {
  if (!isFinite(n) || n <= 0) return '—'
  if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T'
  if (n >= 1e9)  return (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e6)  return (n / 1e6).toFixed(2) + 'M'
  return n.toFixed(0)
}

function fmtPct(pct) {
  if (!isFinite(pct)) return ''
  return (pct > 0 ? '+' : '') + pct.toFixed(2) + '%'
}

const CHAINS      = ['eth', 'base', 'sol']
const CHAIN_LABEL = { eth: 'ETH', base: 'BASE', sol: 'SOL' }
const ARB_EFF     = 0.6

export default function PriceImpact({ collapsed, onToggle }) {
  const [liquidity, setLiquidity] = useState({ eth: null, base: null, sol: null })
  const [currentMC, setCurrentMC] = useState(null)
  const [updatedTs, setUpdatedTs] = useState(null)
  const [tradeInput,  setTradeInput]  = useState('')
  const [targetInput, setTargetInput] = useState('')

  const fetchLiquidity = useCallback(async () => {
    const CHAIN_NAMES = { eth: 'ethereum', base: 'base', sol: 'solana' }
    const [dexResults, onChainLiq] = await Promise.all([
      Promise.allSettled(
        Object.entries(LPS).map(async ([chain, lp]) => {
          const url  = API.dex(`/latest/dex/pairs/${CHAIN_NAMES[chain]}/${lp.address}`)
          const r    = await fetch(url, { cache: 'no-store' })
          const j    = await r.json()
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

  const effLiq = (liquidity.eth || 0) + ((liquidity.base || 0) + (liquidity.sol || 0)) * ARB_EFF
  const price  = currentMC ? currentMC / CIRC_SUPPLY : null

  const handleTradeChange = val => {
    setTradeInput(val)
    const usd = parseAmount(val)
    if (usd > 0 && currentMC && effLiq) {
      const res = calcMCImpact(currentMC, effLiq, usd)
      setTargetInput(res ? fmtShort(res.newMC) : '')
    } else {
      setTargetInput('')
    }
  }

  const handleTargetChange = val => {
    setTargetInput(val)
    const mc = parseAmount(val)
    if (mc > 0 && currentMC && effLiq) {
      const buy = calcRequiredBuy(currentMC, effLiq, mc)
      setTradeInput(buy ? fmtShort(buy) : '')
    } else {
      setTradeInput('')
    }
  }

  const tradeUSD = parseAmount(tradeInput)
  const mcResult = isFinite(tradeUSD) && tradeUSD > 0 ? calcMCImpact(currentMC, effLiq, tradeUSD) : null

  const newLiquidity = mcResult && effLiq > 0
    ? Object.fromEntries(CHAINS.map(chain => {
        const liq    = liquidity[chain]
        if (!liq) return [chain, null]
        const weight = chain === 'eth' ? liq : liq * ARB_EFF
        return [chain, liq + 2 * tradeUSD * (weight / effLiq)]
      }))
    : null

  const tokens = isFinite(tradeUSD) && tradeUSD > 0 && price
    ? Object.fromEntries(CHAINS.map(chain => {
        const liq = liquidity[chain]
        if (!liq) return [chain, null]
        const received = calcTokensReceived(liq, price, tradeUSD)
        const slippage = tradeUSD / (liq / 2 + tradeUSD) * 100
        return [chain, { received, slippage }]
      }))
    : null

  const Card = ({ label, value, sub, subClass }) => (
    <div className={styles.outputCard}>
      <div className={styles.outputLabel}>{label}</div>
      <div className={styles.outputVal}>{value ?? '—'}</div>
      <div className={`${styles.outputSub} ${subClass || ''}`}>{sub ?? ''}</div>
    </div>
  )

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

        {/* Input row — matches Calculator style */}
        <div className={styles.inputRow}>
          <div className={styles.inputCol}>
            <div className="k-eyebrow">Buy Amount</div>
            <div className={styles.usdWrap}>
              <span className={styles.usdPrefix}>$</span>
              <input
                className={styles.input}
                placeholder="1000, 50K, 1M"
                value={tradeInput}
                onChange={e => handleTradeChange(e.target.value.replace(/^\$/, ''))}
              />
            </div>
          </div>
          <div className={styles.inputCol}>
            <div className="k-eyebrow">Target MC</div>
            <div className={styles.targetRow}>
              <div className={styles.usdWrap}>
                <span className={styles.usdPrefix}>$</span>
                <input
                  className={styles.input}
                  placeholder="100M, 1B, 5B"
                  value={targetInput}
                  onChange={e => handleTargetChange(e.target.value.replace(/^\$/, ''))}
                />
              </div>
              {mcResult && (
                <span className="pos" style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', letterSpacing: '0.04em' }}>
                  +{fmtUSD(mcResult.newMC - currentMC)}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Row 1: Current LP per chain */}
        <div className={styles.outputGrid}>
          {CHAINS.map(chain => (
            <Card
              key={`liq-${chain}`}
              label={`${CHAIN_LABEL[chain]} Liquidity`}
              value={liquidity[chain] != null ? fmtUSD(liquidity[chain]) : null}
            />
          ))}

          {/* Row 2: New LP per chain */}
          {CHAINS.map(chain => (
            <Card
              key={`newliq-${chain}`}
              label={`${CHAIN_LABEL[chain]} New LP`}
              value={newLiquidity?.[chain] != null ? fmtUSD(newLiquidity[chain]) : '—'}
              sub={newLiquidity?.[chain] && liquidity[chain]
                ? `+${fmtUSD(newLiquidity[chain] - liquidity[chain])}`
                : undefined}
              subClass="pos"
            />
          ))}

          {/* Row 3: Tokens received per chain */}
          {CHAINS.map(chain => {
            const t = tokens?.[chain]
            return (
              <Card
                key={`tok-${chain}`}
                label={`${CHAIN_LABEL[chain]} Tokens`}
                value={t ? fmtTokens(t.received) : '—'}
                sub={t ? `${t.slippage.toFixed(2)}% slippage` : ''}
              />
            )
          })}
        </div>

        {/* Disclaimer */}
        <div className={styles.disclaimer}>
          <div className={styles.disclaimerTitle}>Estimates only — not financial advice</div>
          <ul className={styles.disclaimerList}>
            <li>Uses constant-product (x·y=k) AMM formula. ETH liquidity fetched from Uniswap V2 contract on-chain. BASE and SOL use DexScreener reported liquidity.</li>
            <li>MC impact uses combined effective liquidity: ETH at 100%, BASE and SOL at 60% — Wormhole bridging latency reduces their arb contribution.</li>
            <li>New LP depths and tokens received are estimated per chain proportionally to each pool's weight.</li>
          </ul>
        </div>

        <div className="k-foot">{fmtUpdated(updatedTs)}</div>
      </div></div>
    </div>
  )
}
