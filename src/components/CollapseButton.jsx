import React from 'react'
import styles from './CollapseButton.module.css'

export default function CollapseButton({ collapsed, onToggle }) {
  return (
    <button
      className={styles.btn}
      onClick={onToggle}
      aria-label={collapsed ? 'Expand' : 'Collapse'}
    >
      <svg
        width="12" height="12" viewBox="0 0 12 12"
        fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round"
        style={{
          transform: collapsed ? 'rotate(0deg)' : 'rotate(180deg)',
          transition: 'transform 0.28s cubic-bezier(.4,0,.2,1)',
        }}
      >
        {/* down chevron — rotated up when expanded */}
        <polyline points="2,4 6,8 10,4" />
      </svg>
    </button>
  )
}
