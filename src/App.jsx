import React, { useState } from 'react'
import NetworkPulse      from './components/NetworkPulse.jsx'
import HoldersChart      from './components/HoldersChart.jsx'
import HolderMilestone   from './components/HolderMilestone.jsx'
import HolderComposition from './components/HolderComposition.jsx'
import TreasuryLP        from './components/TreasuryLP.jsx'
import WalletTracker     from './components/WalletTracker.jsx'
import Calculator        from './components/Calculator.jsx'
import LinksCard         from './components/LinksCard.jsx'
import PriceImpact       from './components/PriceImpact.jsx'
import VolumeChart       from './components/VolumeChart.jsx'
import BuyFeed           from './components/BuyFeed.jsx'
import LeaderBoard       from './components/LeaderBoard.jsx'
import useIsMobile       from './hooks/useIsMobile.js'
import { useTheme }      from './hooks/useTheme.js'
import styles from './App.module.css'

export default function App() {
  const isMobile = useIsMobile(640)
  const { theme, toggle: toggleTheme } = useTheme()

  const [c, setC] = useState({
    network: false, chart: false,
    holderPair: false,
    milestone: false,
    composition: false,
    treasury: false, wallet: false, calculator: false, impact: false,
    volume: false, feed: false, board: false, links: false,
  })
  const toggle = key => setC(prev => ({ ...prev, [key]: !prev[key] }))

  const milestoneCollapsed   = isMobile ? c.milestone   : c.holderPair
  const compositionCollapsed = isMobile ? c.composition : c.holderPair
  const milestoneToggle   = () => toggle(isMobile ? 'milestone'   : 'holderPair')
  const compositionToggle = () => toggle(isMobile ? 'composition' : 'holderPair')

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <span className={styles.headerKendu}>KENDU</span>
          <span className={styles.headerDash}>DASHBOARD</span>
        </div>
        <button className={styles.themeToggle} onClick={toggleTheme} title="Toggle theme">
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
      </header>

      <main className={styles.main}>
        <section className={styles.fullRow}>
          <NetworkPulse collapsed={c.network} onToggle={() => toggle('network')} />
        </section>
        <section className={styles.fullRow}>
          <HoldersChart collapsed={c.chart} onToggle={() => toggle('chart')} />
        </section>
        <section className={styles.twoCol}>
          <HolderMilestone   collapsed={milestoneCollapsed}   onToggle={milestoneToggle} />
          <HolderComposition collapsed={compositionCollapsed} onToggle={compositionToggle} />
        </section>
        <section className={styles.fullRow}>
          <VolumeChart collapsed={c.volume} onToggle={() => toggle('volume')} />
        </section>
        <section className={styles.twoCol}>
          <LeaderBoard collapsed={c.board} onToggle={() => toggle('board')} />
          <BuyFeed     collapsed={c.feed}  onToggle={() => toggle('feed')} />
        </section>
        <section className={styles.fullRow}>
          <TreasuryLP collapsed={c.treasury} onToggle={() => toggle('treasury')} />
        </section>
        <section className={styles.fullRow}>
          <WalletTracker collapsed={c.wallet} onToggle={() => toggle('wallet')} />
        </section>
        <section className={styles.fullRow}>
          <Calculator collapsed={c.calculator} onToggle={() => toggle('calculator')} />
        </section>
        <section className={styles.fullRow}>
          <PriceImpact collapsed={c.impact} onToggle={() => toggle('impact')} />
        </section>
        <section className={styles.fullRow}>
          <LinksCard collapsed={c.links} onToggle={() => toggle('links')} />
        </section>
      </main>

      <footer className={styles.footer}>
        <img src="/kendu-mask.png" alt="Kendu" className={styles.footerMask} />
        <span className={styles.footerLabel}>HIGHER</span>
      </footer>
    </div>
  )
}
