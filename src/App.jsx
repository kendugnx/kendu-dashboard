import React, { useState } from 'react'
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'

import NetworkPulse      from './components/NetworkPulse.jsx'
import HoldersChart      from './components/HoldersChart.jsx'
import HolderMilestone   from './components/HolderMilestone.jsx'
import HolderComposition from './components/HolderComposition.jsx'
import HolderConcentration from './components/HolderConcentration.jsx'
import TreasuryLP        from './components/TreasuryLP.jsx'
import WalletTracker     from './components/WalletTracker.jsx'
import Calculator        from './components/Calculator.jsx'
import LinksCard         from './components/LinksCard.jsx'
import PriceImpact       from './components/PriceImpact.jsx'
import VolumeChart       from './components/VolumeChart.jsx'
import BuyFeed           from './components/BuyFeed.jsx'
import LeaderBoard       from './components/LeaderBoard.jsx'
import SortableRow       from './components/SortableRow.jsx'
import SnapshotModal     from './components/SnapshotModal.jsx'
import useIsMobile       from './hooks/useIsMobile.js'
import { useTheme }      from './hooks/useTheme.js'
import { useSortableOrder } from './hooks/useSortableOrder.js'
import styles from './App.module.css'

export default function App() {
  const isMobile = useIsMobile(640)
  const { theme, toggle: toggleTheme } = useTheme()
  const { order, handleDragEnd, resetOrder } = useSortableOrder(isMobile)
  const [showSnapshot, setShowSnapshot] = useState(false)

  const ALL_KEYS = ['network', 'chart', 'holderTrio', 'milestone', 'composition', 'concentration', 'treasury', 'wallet', 'calculator', 'impact', 'volume', 'feedPair', 'feed', 'board', 'links']

  const [c, setC] = useState(() => Object.fromEntries(ALL_KEYS.map(k => [k, false])))
  const toggle = key => setC(prev => ({ ...prev, [key]: !prev[key] }))

  const allCollapsed = ALL_KEYS.every(k => c[k])
  const toggleAll = () => setC(Object.fromEntries(ALL_KEYS.map(k => [k, !allCollapsed])))

  const concentrationCollapsed = isMobile ? c.concentration : c.holderTrio
  const milestoneCollapsed     = isMobile ? c.milestone     : c.holderTrio
  const compositionCollapsed   = isMobile ? c.composition   : c.holderTrio
  const concentrationToggle = () => toggle(isMobile ? 'concentration' : 'holderTrio')
  const milestoneToggle     = () => toggle(isMobile ? 'milestone'     : 'holderTrio')
  const compositionToggle   = () => toggle(isMobile ? 'composition'   : 'holderTrio')

  const boardCollapsed = isMobile ? c.board : c.feedPair
  const feedCollapsed  = isMobile ? c.feed  : c.feedPair
  const boardToggle = () => toggle(isMobile ? 'board' : 'feedPair')
  const feedToggle  = () => toggle(isMobile ? 'feed'  : 'feedPair')

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  // Map of row id → rendered content
  const rowContent = {
    network:    <section className={styles.fullRow}><NetworkPulse collapsed={c.network} onToggle={() => toggle('network')} /></section>,
    chart:      <section className={styles.fullRow}><HoldersChart collapsed={c.chart} onToggle={() => toggle('chart')} /></section>,
    holderTrio: <section className={styles.threeCol}>
                  <HolderMilestone     collapsed={milestoneCollapsed}     onToggle={milestoneToggle} />
                  <HolderConcentration collapsed={concentrationCollapsed} onToggle={concentrationToggle} />
                  <HolderComposition   collapsed={compositionCollapsed}   onToggle={compositionToggle} />
                </section>,
    milestone:  <section className={styles.fullRow}><HolderMilestone   collapsed={c.milestone}   onToggle={() => toggle('milestone')} /></section>,
    composition:<section className={styles.fullRow}><HolderComposition collapsed={c.composition} onToggle={() => toggle('composition')} /></section>,
    concentration:<section className={styles.fullRow}><HolderConcentration collapsed={c.concentration} onToggle={() => toggle('concentration')} /></section>,
    volume:     <section className={styles.fullRow}><VolumeChart collapsed={c.volume} onToggle={() => toggle('volume')} /></section>,
    feedPair:   <section className={styles.twoCol}>
                  <LeaderBoard collapsed={boardCollapsed} onToggle={boardToggle} />
                  <BuyFeed     collapsed={feedCollapsed}  onToggle={feedToggle} />
                </section>,
    board:      <section className={styles.fullRow}><LeaderBoard collapsed={c.board} onToggle={() => toggle('board')} /></section>,
    feed:       <section className={styles.fullRow}><BuyFeed     collapsed={c.feed}  onToggle={() => toggle('feed')} /></section>,
    treasury:   <section className={styles.fullRow}><TreasuryLP  collapsed={c.treasury}   onToggle={() => toggle('treasury')} /></section>,
    wallet:     <section className={styles.fullRow}><WalletTracker collapsed={c.wallet}   onToggle={() => toggle('wallet')} /></section>,
    calculator: <section className={styles.fullRow}><Calculator   collapsed={c.calculator} onToggle={() => toggle('calculator')} /></section>,
    impact:     <section className={styles.fullRow}><PriceImpact  collapsed={c.impact}    onToggle={() => toggle('impact')} /></section>,
    links:      <section className={styles.fullRow}><LinksCard    collapsed={c.links}     onToggle={() => toggle('links')} /></section>,
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.headerText}>
            <span className={styles.headerKendu}>KENDU</span>
            <span className={styles.headerDash}>DASHBOARD</span>
          </div>
          <div className={styles.headerLeft}>
            <button className={styles.headerBtn} onClick={toggleAll} title={allCollapsed ? 'Expand all' : 'Collapse all'}>
              {allCollapsed ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
                  <polyline points="18 15 12 9 6 15"/>
                </svg>
              )}
            </button>
            <button className={styles.headerBtn} onClick={resetOrder} title="Reset card order">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
                <path d="M12 19a7 7 0 0 0 0-14H8"/>
                <polyline points="11 3 8 5 11 7"/>
              </svg>
            </button>
          </div>
          <div className={styles.headerRight}>
            <button className={styles.headerBtn} onClick={toggleTheme} title="Toggle theme">
              {theme === 'dark' ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
                  <ellipse cx="12" cy="12" rx="9" ry="5.5"/>
                  <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none"/>
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
                  <path d="M3 12c2.5-5.5 15.5-5.5 18 0"/>
                  <path d="M3 12c2.5 5.5 15.5 5.5 18 0"/>
                  <line x1="5" y1="5" x2="19" y2="19"/>
                </svg>
              )}
            </button>
            <button className={styles.headerBtn} onClick={() => setShowSnapshot(true)} title="Snapshot">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                <circle cx="12" cy="13" r="4"/>
              </svg>
            </button>
          </div>
        </div>
      </header>

      <main className={styles.main}>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={order} strategy={verticalListSortingStrategy}>
            {order.map(id => (
              <SortableRow key={id} id={id}>
                {rowContent[id]}
              </SortableRow>
            ))}
          </SortableContext>
        </DndContext>
      </main>

      <footer className={styles.footer}>
        <img src={theme === 'light' ? '/Kendu Mask Logo - Black.png' : '/kendu-mask.png'} alt="Kendu" className={styles.footerMask} />
        <span className={styles.footerLabel}>HIGHER</span>
      </footer>

      {showSnapshot && <SnapshotModal onClose={() => setShowSnapshot(false)} />}
    </div>
  )
}
