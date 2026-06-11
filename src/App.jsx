import React, { useState } from 'react'
import NetworkPulse      from './components/NetworkPulse.jsx'
import HoldersChart      from './components/HoldersChart.jsx'
import HolderMilestone   from './components/HolderMilestone.jsx'
import HolderComposition from './components/HolderComposition.jsx'
import TreasuryLP        from './components/TreasuryLP.jsx'
import Calculator        from './components/Calculator.jsx'
import LinksCard         from './components/LinksCard.jsx'
import PriceImpact       from './components/PriceImpact.jsx'
import useIsMobile       from './hooks/useIsMobile.js'
import styles from './App.module.css'

export default function App() {
  const isMobile = useIsMobile(640)

  const [c, setC] = useState({
    network: false, chart: false,
    holderPair: false,   // milestone + composition share this on desktop
    milestone: false,    // individual on mobile
    composition: false,  // individual on mobile
    treasury: false, calculator: false, impact: false, links: false,
  })
  const toggle = key => setC(prev => ({ ...prev, [key]: !prev[key] }))

  const milestoneCollapsed    = isMobile ? c.milestone    : c.holderPair
  const compositionCollapsed  = isMobile ? c.composition  : c.holderPair
  const milestoneToggle   = () => toggle(isMobile ? 'milestone'   : 'holderPair')
  const compositionToggle = () => toggle(isMobile ? 'composition' : 'holderPair')

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <img src="/kendu-logo.png" alt="KENDU" className={styles.logo} />
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
          <TreasuryLP collapsed={c.treasury} onToggle={() => toggle('treasury')} />
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
