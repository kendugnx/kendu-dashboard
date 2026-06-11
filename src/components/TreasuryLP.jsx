import React, { useState, useEffect, useCallback } from 'react'
import RefreshButton from './RefreshButton.jsx'
import CollapseButton from './CollapseButton.jsx'
import { useRefresh } from '../hooks/useRefresh.js'
import { fmtUSD, fmtUpdated, getJSON } from '../utils/index.js'
import { API } from '../utils/apiBase.js'

const IS_DEV = import.meta.env.DEV

async function fetchTreasuryDirect() {
  const url = API.ethplorer(`/getAddressInfo/0xD22849fcB4C83389E65a1c40748a9b67157638A3?apiKey=freekey`)
  const j = await getJSON(url)
  const ethBal = Number(j?.ETH?.balance ?? 0)
  const ethPrice = Number(j?.ETH?.price?.rate ?? 0)
  let total = ethBal * ethPrice
  for (const t of (j?.tokens ?? [])) {
    const bal = Number(t.balance) / Math.pow(10, Number(t.tokenInfo?.decimals ?? 18))
    const price = Number(t.tokenInfo?.price?.rate ?? 0)
    if (isFinite(bal) && price > 0) total += bal * price
  }
  return isFinite(total) && total > 0 ? total : null
}

async function fetchLPDirect(chain, pairAddr) {
  const url = API.dex(`/latest/dex/pairs/${chain}/${pairAddr}`)
  const j = await getJSON(url)
  const pair = Array.isArray(j?.pairs) ? j.pairs[0] : j?.pair
  const liq = Number(pair?.liquidity?.usd)
  return isFinite(liq) && liq > 0 ? liq : null
}
import { TREASURY_ETHERSCAN_URL, LPS } from '../utils/constants.js'
import styles from './TreasuryLP.module.css'

export default function TreasuryLP({ collapsed, onToggle }) {
  const [treasury,  setTreasury]  = useState(null)
  const [lpEth,     setLpEth]     = useState(null)
  const [lpBase,    setLpBase]    = useState(null)
  const [lpSol,     setLpSol]     = useState(null)
  const [updatedTs, setUpdatedTs] = useState(null)

  const loadAll = useCallback(async () => {
    if (IS_DEV) {
      // In local dev, call APIs directly via Vite proxy
      const [treas, eth, base, sol] = await Promise.allSettled([
        fetchTreasuryDirect(),
        fetchLPDirect('ethereum', '0xD9f2A7471d1998C69De5Cae6dF5d3f070F01DF9F'),
        fetchLPDirect('base',     '0xFBFD0e1838A101a26FDB5D4ae0B4D17153eCA66B'),
        fetchLPDirect('solana',   'B34Pu6w8eecYRXLEDxBCPy5JoFLy3iycLAPJpYiwbKMK'),
      ])
      if (treas.status === 'fulfilled' && treas.value != null) setTreasury(treas.value)
      if (eth.status   === 'fulfilled' && eth.value   != null) setLpEth(eth.value)
      if (base.status  === 'fulfilled' && base.value  != null) setLpBase(base.value)
      if (sol.status   === 'fulfilled' && sol.value   != null) setLpSol(sol.value)
    } else {
      const r = await fetch('/api/treasury', { cache: 'no-store' })
      const j = await r.json()
      if (j.treasury != null) setTreasury(j.treasury)
      if (j.lpEth    != null) setLpEth(j.lpEth)
      if (j.lpBase   != null) setLpBase(j.lpBase)
      if (j.lpSol    != null) setLpSol(j.lpSol)
    }
    setUpdatedTs(Date.now())
  }, [])

  const { spinning, trigger } = useRefresh(loadAll)
  useEffect(() => { loadAll() }, [])

  const pools = [
    { label: 'Treasury Wallet', val: treasury,  link: TREASURY_ETHERSCAN_URL, btnLabel: 'View Treasury' },
    { label: LPS.eth.label,     val: lpEth,     link: LPS.eth.link,           btnLabel: 'View Pool' },
    { label: LPS.base.label,    val: lpBase,    link: LPS.base.link,          btnLabel: 'View Pool' },
    { label: LPS.sol.label,     val: lpSol,     link: LPS.sol.link,           btnLabel: 'View Pool' },
  ]

  return (
    <div className={`k-card ${styles.wrap}`}>
      <div className={styles.head}>
        <div>
          <div className="k-eyebrow">Treasury & Liquidity</div>
          <strong className={styles.title}>Treasury & LP</strong>
        </div>
        <div className="k-head-actions">
          <RefreshButton spinning={spinning} onClick={trigger} />
          <CollapseButton collapsed={collapsed} onToggle={onToggle} />
        </div>
      </div>

      <div className={`k-body${collapsed ? ' k-collapsed' : ''}`}><div className="k-body-inner">
      <div className={styles.grid}>
        {pools.map(p => (
          <div key={p.label} className={styles.poolCard}>
            <div className={styles.poolLabel}>{p.label}</div>
            <div className={styles.poolVal}>{p.val != null ? fmtUSD(p.val) : '—'}</div>
            <a
              href={p.link}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.viewBtn}
            >{p.btnLabel}</a>
          </div>
        ))}
      </div>

      <div className="k-foot">{fmtUpdated(updatedTs)}</div>
      </div></div>{/* k-body */}
    </div>
  )
}
