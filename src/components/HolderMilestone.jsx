import React, { useState, useEffect, useCallback } from 'react'
import RefreshButton from './RefreshButton.jsx'
import CollapseButton from './CollapseButton.jsx'
import { useRefresh } from '../hooks/useRefresh.js'
import { fetchCSV, fmtNum, fmtUpdated } from '../utils/index.js'
import { HOLDERS_CSV_URL } from '../utils/constants.js'
import styles from './HolderMilestone.module.css'

const MILESTONES = [
  1000, 2500, 5000, 7500, 10000, 12500, 15000, 17500,
  20000, 25000, 30000, 40000, 50000, 75000, 100000,
]

function parseTotal(text) {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return null
  const header = lines[0].split(',').map(s => s.trim().toLowerCase().replace(/[^a-z0-9]/g,''))
  const totalIdx = header.findIndex(h => /total/.test(h))
  const ethIdx   = header.findIndex(h => /eth/.test(h))
  const baseIdx  = header.findIndex(h => /base/.test(h))
  const solIdx   = header.findIndex(h => /sol/.test(h))
  // Take last non-empty row
  for (let i = lines.length - 1; i >= 1; i--) {
    const cols = lines[i].split(',').map(s => s.trim())
    const num = idx => idx >= 0 ? Number(String(cols[idx] ?? '').replace(/[^\d]/g,'')) : NaN
    const total = isFinite(num(totalIdx)) ? num(totalIdx)
      : [num(ethIdx), num(baseIdx), num(solIdx)].filter(isFinite).reduce((a,b)=>a+b, 0)
    if (isFinite(total) && total > 0) return total
  }
  return null
}

function nextGoal(n) {
  return MILESTONES.find(m => m > n) ?? MILESTONES[MILESTONES.length - 1] * 2
}
// The floor is the highest milestone the user has already passed
function floorGoal(total) {
  if (!isFinite(total)) return 0
  const passed = MILESTONES.filter(m => m <= total)
  return passed.length ? passed[passed.length - 1] : 0
}

export default function HolderMilestone({ collapsed, onToggle }) {
  const [total,     setTotal]     = useState(null)
  const [goalIdx,   setGoalIdx]   = useState(null)
  const [updatedTs, setUpdatedTs] = useState(null)

  const loadData = useCallback(async () => {
    const txt = await fetchCSV(HOLDERS_CSV_URL)
    const t = parseTotal(txt)
    if (t != null) {
      setTotal(t)
      if (goalIdx == null) setGoalIdx(MILESTONES.findIndex(m => m > t))
    }
    setUpdatedTs(Date.now())
  }, [goalIdx])

  const { spinning, trigger } = useRefresh(loadData)
  useEffect(() => { loadData() }, [])

  const goal        = goalIdx != null && goalIdx >= 0 ? MILESTONES[goalIdx] : nextGoal(total ?? 0)
  const goalReached = isFinite(total) && total >= goal
  const until       = goalReached ? 0 : isFinite(total) ? Math.max(0, goal - total) : null
  // frac: simple % of goal reached (0 to goal), not relative to previous milestone
  const frac        = goalReached ? 1 : (isFinite(total) && goal > 0)
    ? Math.min(1, Math.max(0, total / goal))
    : 0

  // SVG ring
  const RADIUS  = 80
  const CIRC    = 2 * Math.PI * RADIUS
  const offset  = CIRC * (1 - frac)

  const step = dir => {
    setGoalIdx(prev => {
      const next = (prev ?? 0) + dir
      return Math.max(0, Math.min(MILESTONES.length - 1, next))
    })
  }

  return (
    <div className={`k-card ${styles.wrap}`}>
      <div className={styles.head}>
        <div>
          <div className="k-eyebrow">Holder Milestone</div>
          <div className={styles.goalNum}>{fmtNum(goal)}</div>
        </div>
        <div className="k-head-actions">
          <RefreshButton spinning={spinning} onClick={trigger} />
          <CollapseButton collapsed={collapsed} onToggle={onToggle} />
        </div>
      </div>

      <div className={`k-body${collapsed ? ' k-collapsed' : ''}`}><div className="k-body-inner">
      <div className={styles.ringArea}>
        <button className={styles.arrow} onClick={() => step(-1)} aria-label="Previous milestone">&#8249;</button>

        <div className={styles.ringWrap}>
          <svg className={styles.ring} viewBox="0 0 200 200">
            {/* Track */}
            <circle
              cx="100" cy="100" r={RADIUS}
              fill="none"
              stroke="rgba(240,92,78,.2)"
              strokeWidth="12"
            />
            {/* Progress */}
            <circle
              cx="100" cy="100" r={RADIUS}
              fill="none"
              stroke="#F05C4E"
              strokeWidth="12"
              strokeLinecap="butt"
              strokeDasharray={CIRC}
              strokeDashoffset={offset}
              transform="rotate(-90 100 100)"
              style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(.22,.61,.36,1)' }}
            />
          </svg>
          <div className={styles.ringCenter}>
            {goalReached ? (
              <>
                <div className={styles.ringNum} style={{ fontSize: '18px', color: 'var(--positive)' }}>✓</div>
                <div className={styles.ringSub} style={{ color: 'var(--positive)' }}>Goal Reached!</div>
              </>
            ) : (
              <>
                <div className={styles.ringNum}>{until != null ? fmtNum(until) : '—'}</div>
                <div className={styles.ringSub}>Until Goal</div>
              </>
            )}
          </div>
        </div>

        <button className={styles.arrow} onClick={() => step(1)} aria-label="Next milestone">&#8250;</button>
      </div>

      {/* Mobile progress bar */}
      <div className={styles.mobileBar}>
        <div className={styles.mobileArrows}>
          <button className={styles.arrow} onClick={() => step(-1)} aria-label="Previous milestone">&#8249;</button>
          <span className={styles.mobileGoalLabel}>{fmtNum(goal)}</span>
          <button className={styles.arrow} onClick={() => step(1)} aria-label="Next milestone">&#8250;</button>
        </div>
        <div className={styles.mobileBarTrack}>
          <div className={styles.mobileBarFill} style={{ width: `${frac * 100}%` }} />
        </div>
        <div className={styles.mobileBarLabels}>
          <span>0</span>
          <span className={styles.mobileUntil}>{goalReached ? 'Goal Reached!' : until != null ? fmtNum(until) + ' to go' : '—'}</span>
          <span>{fmtNum(goal)}</span>
        </div>
      </div>

      <div className="k-foot">{fmtUpdated(updatedTs)}</div>
      </div></div>{/* k-body */}
    </div>
  )
}
