import React, { useState, useEffect, useCallback } from 'react'
import RefreshButton from './RefreshButton.jsx'
import CollapseButton from './CollapseButton.jsx'
import { useRefresh } from '../hooks/useRefresh.js'
import { fmtUSD, fmtUpdated, parseAmount } from '../utils/index.js'
import { KENDU_ETH_CA, CIRC_SUPPLY, TIER_DEFS, tierForMC, tierForTokens } from '../utils/constants.js'
import { API } from '../utils/apiBase.js'
import styles from './Calculator.module.css'

const IS_DEV = import.meta.env.DEV
const QUICK_MULTIPLES = [20, 50, 100, 1000]

function pickBestPair(pairs) {
  const eth = (pairs || []).filter(p => (p.chainId || '').toLowerCase() === 'ethereum')
  const arr = eth.length ? eth : (pairs || [])
  arr.sort((a, b) => ((b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)))
  return arr[0]
}

function shortMC(n) {
  if (!isFinite(n)) return '?'
  if (n >= 1e9)  return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B'
  if (n >= 1e6)  return Math.round(n / 1e6) + 'M'
  if (n >= 1e3)  return Math.round(n / 1e3) + 'K'
  return String(n)
}

function fmtTierRange(t) {
  if (!t) return ''
  if (t.min === 0 && t.max < Infinity) return `< ${shortMC(t.max)}`
  if (t.max === Infinity) return `> ${shortMC(t.min)}`
  return `${shortMC(t.min)} – ${shortMC(t.max)}`
}

export default function Calculator({ collapsed, onToggle }) {
  const [spotMC,      setSpotMC]      = useState(null)
  const [spotPrice,   setSpotPrice]   = useState(null)
  const [poolLiq,     setPoolLiq]     = useState(null)
  const [mcChange24h, setMcChange24h] = useState(null)
  const [dexLink,     setDexLink]     = useState('https://dexscreener.com')
  const [targetInput, setTargetInput] = useState('')
  const [holdInput,   setHoldInput]   = useState('')
  const [addInput,    setAddInput]    = useState('')
  const [activeMulti, setActiveMulti] = useState(null)
  const [updatedTs,   setUpdatedTs]   = useState(null)
  const [selectedTierIdx, setSelectedTierIdx] = useState(-1)
  const [pinnedAddTokens, setPinnedAddTokens] = useState(null)  // exact tokens from tier click
  const [tiersOpen, setTiersOpen] = useState(false)

  const loadSpot = useCallback(async () => {
    const url = IS_DEV
      ? API.dex(`/latest/dex/tokens/${KENDU_ETH_CA}`)
      : API.dexscreener(`type=token&address=${encodeURIComponent(KENDU_ETH_CA)}`)
    const r = await fetch(url, { cache: 'no-store' })
    const j = await r.json()
    const best = pickBestPair(j?.pairs || [])
    if (!best) throw new Error('No pair found')
    const mc    = Number(best.marketCap || 0) || (Number(best.priceUsd || 0) * CIRC_SUPPLY)
    const price = Number(best.priceUsd || 0)
    const link  = `https://dexscreener.com/${best.chainId || 'ethereum'}/${best.pairAddress || ''}`
    if (isFinite(mc) && mc > 0) setSpotMC(mc)
    if (isFinite(price) && price > 0) setSpotPrice(price)
    const liq = Number(best.liquidity?.usd || 0)
    if (isFinite(liq) && liq > 0) setPoolLiq(liq)
    const chg = Number(best.priceChange?.h24)
    if (isFinite(chg)) setMcChange24h(chg)
    setDexLink(link)
    setUpdatedTs(Date.now())
  }, [])

  const { spinning, trigger } = useRefresh(loadSpot)
  useEffect(() => { loadSpot() }, [])

  // ---- Derived calculations ----
  const targetMC       = activeMulti && isFinite(spotMC) ? spotMC * activeMulti : parseAmount(targetInput)
  const currentTokens  = parseAmount(holdInput)
  const addUSD         = parseAmount(addInput)
  const multiplier     = (isFinite(targetMC) && isFinite(spotMC) && spotMC > 0) ? targetMC / spotMC : NaN
  const pctIncrease    = isFinite(multiplier) ? (multiplier - 1) * 100 : NaN
  const valueAtCurrent = (isFinite(currentTokens) && isFinite(spotPrice)) ? currentTokens * spotPrice : NaN
  const priceAtTarget  = (isFinite(spotPrice) && isFinite(multiplier)) ? spotPrice * multiplier : NaN
  const valueAtTarget  = (isFinite(currentTokens) && isFinite(priceAtTarget)) ? currentTokens * priceAtTarget : NaN
  // Use x·y=k AMM formula so tokens received matches what you'd actually get on-chain.
  // Tier clicks pin an exact token count (tier boundary math); manual USD input uses AMM.
  const ammTokens = isFinite(addUSD) && addUSD > 0 && poolLiq > 0 && spotPrice > 0
    ? (() => {
        const q = poolLiq / 2
        const x0 = q / spotPrice
        return x0 - (x0 * q) / (q + addUSD)
      })()
    : NaN
  const addTokens = pinnedAddTokens != null ? pinnedAddTokens
    : isFinite(ammTokens) ? ammTokens : NaN
  const newTokenBal    = (isFinite(currentTokens) && isFinite(addTokens)) ? currentTokens + addTokens : (isFinite(currentTokens) ? currentTokens : NaN)
  const newValueTarget = (isFinite(newTokenBal) && isFinite(priceAtTarget)) ? newTokenBal * priceAtTarget : NaN
  const totalInvested  = isFinite(valueAtCurrent) ? valueAtCurrent + (isFinite(addUSD) && addUSD > 0 ? addUSD : 0) : NaN

  // ---- Tier logic (token amounts only, no MC involvement) ----
  // currentTierIdx: where your current holdings sit
  // prospectIdx: where you land after adding the additional investment
  const baseTok        = isFinite(currentTokens) && currentTokens > 0 ? currentTokens : 0
  const addTok         = isFinite(addTokens) && addTokens > 0 ? addTokens : 0
  const effTok         = baseTok + addTok
  const currentTierIdx = baseTok > 0 ? tierForTokens(baseTok) : -1
  // If user explicitly clicked a tier, use that as prospect -- don't compute from effTok
  const computedProspect = addTok > 0 && effTok > baseTok && selectedTierIdx < 0 ? tierForTokens(effTok) : -1
  const prospectIdx    = selectedTierIdx > currentTierIdx ? selectedTierIdx : computedProspect
  const tiersGained    = currentTierIdx >= 0 && prospectIdx > currentTierIdx ? prospectIdx - currentTierIdx : 0
  // "until next tier" = tokens needed to reach next tier above prospect (or current if no prospect)
  const refTierIdx     = prospectIdx > currentTierIdx ? prospectIdx : currentTierIdx
  const nextTierDef    = refTierIdx >= 0 ? TIER_DEFS[refTierIdx + 1] : null
  const tokensToNext   = nextTierDef ? Math.max(0, nextTierDef.min - effTok) : NaN
  const untilNextTier  = isFinite(tokensToNext) && isFinite(spotPrice) && spotPrice > 0
    ? tokensToNext * spotPrice : NaN

  const setMulti = n => {
    if (activeMulti === n) {
      setActiveMulti(null)
      setTargetInput('')
    } else {
      setActiveMulti(n)
      // Auto-populate the target input with the computed MC
      if (isFinite(spotMC) && spotMC > 0) {
        const computed = spotMC * n
        // Format as shorthand e.g. "45.2M", "1.2B"
        const fmt = v => {
          if (v >= 1e9)  return (v / 1e9).toFixed(2).replace(/\.?0+$/, '') + 'B'
          if (v >= 1e6)  return (v / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M'
          if (v >= 1e3)  return (v / 1e3).toFixed(0) + 'K'
          return String(Math.round(v))
        }
        setTargetInput(fmt(computed))
      }
    }
  }
  const handleTargetInput = val => { setTargetInput(val); setActiveMulti(null) }

  const handleTierClick = useCallback((tierIdx) => {
    if (tierIdx <= currentTierIdx) return
    // Toggle off if clicking the same tier again
    if (tierIdx === selectedTierIdx) {
      setSelectedTierIdx(-1)
      setPinnedAddTokens(null)
      setAddInput('')
      return
    }
    if (!isFinite(spotPrice) || spotPrice <= 0) return
    const t = TIER_DEFS[tierIdx]
    if (!t) return
    // Target = tier minimum tokens (Seaweed special case: 999,999)
    const targetTok = t.name === 'Seaweed' ? 999_000 : t.min
    const tokensNeeded = Math.max(0, targetTok - baseTok)
    const usdNeeded = tokensNeeded * spotPrice
    setSelectedTierIdx(tierIdx)
    setPinnedAddTokens(tokensNeeded)  // store exact token count
    setAddInput(usdNeeded < 1 ? '0' : Math.round(usdNeeded).toString())
  }, [currentTierIdx, selectedTierIdx, baseTok, spotPrice])

  // Reorder tiers top-to-bottom column by column (3 cols)
  const COLS = 3
  const ROWS = Math.ceil(TIER_DEFS.length / COLS)
  const tiersOrdered = []
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const idx = col * ROWS + row
      if (idx < TIER_DEFS.length) tiersOrdered.push({ tier: TIER_DEFS[idx], origIdx: idx })
    }
  }

  return (
    <div className={`k-card ${styles.wrap}`}>
      {/* Header */}
      <div className={styles.head}>
        <div>
          <div className="k-eyebrow">Market Cap Calculator</div>
          <div className={styles.spotMCRow}>
            <div className={styles.spotMC}>{spotMC != null ? fmtUSD(spotMC) : '—'}</div>
            {mcChange24h != null && (
              <span className={mcChange24h > 0 ? 'pos' : mcChange24h < 0 ? 'neg' : ''} style={{ fontSize: '13px', fontWeight: 600 }}>
                {mcChange24h > 0 ? '+' : ''}{mcChange24h.toFixed(2)}%
              </span>
            )}
          </div>
        </div>
        <div className="k-head-actions">
          <RefreshButton spinning={spinning} onClick={trigger} />
          <CollapseButton collapsed={collapsed} onToggle={onToggle} />
        </div>
      </div>

      <div className={`k-body${collapsed ? ' k-collapsed' : ''}`}><div className="k-body-inner">
      <a href={dexLink} target="_blank" rel="noopener noreferrer" className={styles.dexLink}>
        View on Dexscreener ↗
      </a>
      {/* Input row */}
      <div className={styles.inputRow}>
        <div className={styles.inputCol}>
          <div className="k-eyebrow">Target Market Cap</div>
          <div className={styles.targetField}>
            <input
              className={styles.input}
              placeholder="E.g. 1B"
              value={targetInput}
              onChange={e => handleTargetInput(e.target.value)}
            />
            {QUICK_MULTIPLES.map(n => (
              <button
                key={n}
                className={`k-chip ${styles.multiChip} ${activeMulti === n ? 'active' : ''}`}
                onClick={() => setMulti(n)}
              >{n}x</button>
            ))}
          </div>
        </div>
        <div className={styles.inputCol}>
          <div className="k-eyebrow">Current Holdings</div>
          <input className={styles.input} placeholder="E.g. 100M, 1B" value={holdInput} onChange={e => setHoldInput(e.target.value)} />
        </div>
        <div className={styles.inputCol}>
          <div className="k-eyebrow">Additional Investment</div>
          <div className={styles.usdInputWrap}>
            <span className={styles.usdPrefix}>$</span>
            <input
              className={`${styles.input} ${styles.usdInput}`}
              placeholder="100, 1000, 10K"
              value={addInput}
              onChange={e => { setAddInput(e.target.value.replace(/^\$/, '')); setSelectedTierIdx(-1); setPinnedAddTokens(null) }}
            />
          </div>
        </div>
      </div>

      {/* Output grid */}
      <div className={styles.outputGrid}>
        <div className={styles.outputCard}>
          <div className={styles.outputLabel}>How Many X</div>
          <div className={styles.outputVal}>{isFinite(multiplier) ? multiplier.toFixed(2) + '×' : '—'}</div>
        </div>
        <div className={styles.outputCard}>
          <div className={styles.outputLabel}>Value @ Current MC</div>
          <div className={styles.outputVal}>{isFinite(valueAtCurrent) ? fmtUSD(valueAtCurrent) : '—'}</div>
        </div>
        <div className={styles.outputCard}>
          <div className={styles.outputLabel}>New Token Balance</div>
          <div className={styles.outputVal}>
            {isFinite(newTokenBal) ? fmtUSD(newTokenBal).replace('$','') : '—'}
            <span className={styles.subVal}>{isFinite(addTokens) && addTokens > 0 ? `+${fmtUSD(addTokens).replace('$','')} tokens` : ' '}</span>
          </div>
        </div>
        <div className={styles.outputCard}>
          <div className={styles.outputLabel}>Percent Increase</div>
          <div className={styles.outputVal}>{isFinite(pctIncrease) ? '+' + Math.round(pctIncrease) + '%' : '—'}</div>
        </div>
        <div className={styles.outputCard}>
          <div className={styles.outputLabel}>Value @ Target MC</div>
          <div className={styles.outputVal}>{isFinite(valueAtTarget) ? fmtUSD(valueAtTarget) : '—'}</div>
        </div>
        <div className={styles.outputCard}>
          <div className={styles.outputLabel}>New Value @ Target</div>
          <div className={styles.outputVal}>
            {isFinite(newValueTarget) ? fmtUSD(newValueTarget) : '—'}
            <span className={styles.subVal}>{isFinite(newValueTarget) && isFinite(valueAtTarget) && newValueTarget > valueAtTarget ? `+${fmtUSD(newValueTarget - valueAtTarget)}` : ' '}</span>
          </div>
        </div>
      </div>

      {/* Holder Tiers -- collapsible */}
      <div className={styles.tiersSection}>
        <button className={styles.tiersToggle} onClick={() => setTiersOpen(o => !o)}>
          <span className={`${styles.tiersChevron}${tiersOpen ? ` ${styles.tiersChevronOpen}` : ''}`}>▶</span>
          Holder Tiers
        </button>

        {/* Tier summary bar -- shows when holdings entered, even while collapsed */}
        {currentTierIdx >= 0 && (
          <div className={styles.tierBar}>
            {currentTierIdx === TIER_DEFS.length - 1
              ? 'YOU ARE ETERNAL.'
              : tiersGained > 0
                ? prospectIdx === TIER_DEFS.length - 1
                  ? `+${tiersGained} tier${tiersGained !== 1 ? 's' : ''}: ${isFinite(totalInvested) ? fmtUSD(totalInvested) : '$0.00'} (ETERNAL)`
                  : `+${tiersGained} tier${tiersGained !== 1 ? 's' : ''}: ${isFinite(totalInvested) ? fmtUSD(totalInvested) : '$0.00'} (+${isFinite(untilNextTier) ? fmtUSD(untilNextTier) : '—'} until next tier)`
                : `+0 tiers: ${isFinite(totalInvested) ? fmtUSD(totalInvested) : '$0.00'} (+${isFinite(untilNextTier) ? fmtUSD(untilNextTier) : '—'} until next tier)`
            }
          </div>
        )}

        <div className={`${styles.tiersBody}${tiersOpen ? '' : ` ${styles.tiersBodyCollapsed}`}`}>
          <div className={styles.tiersInner}>
            <div className={styles.tiersGrid}>
              {tiersOrdered.map(({ tier: t, origIdx: i }) => (
                <div
                  key={t.name}
      className={[
                    styles.tierCell,
                    i > currentTierIdx ? styles.tierClickable : '',
                    i === prospectIdx && i !== currentTierIdx ? styles.tierTarget : '',
                    i === currentTierIdx && i !== prospectIdx ? styles.tierCurrent : '',
                    i === currentTierIdx && i === prospectIdx ? styles.tierBoth   : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => handleTierClick(i)}
                >
                  <span className={styles.tierName}>{t.name}</span>
                  <span className={styles.tierRange}>{fmtTierRange(t)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="k-foot">{fmtUpdated(updatedTs)}</div>
      </div></div>{/* k-body */}
    </div>
  )
}
