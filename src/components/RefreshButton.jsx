import React from 'react'

export default function RefreshButton({ onClick, spinning, disabled }) {
  return (
    <button
      className="k-btn-icon"
      onClick={onClick}
      disabled={disabled || spinning}
      aria-label="Refresh"
      title="Refresh"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={spinning ? 'spin' : ''}
        aria-hidden="true"
      >
        <polyline points="23 4 23 10 17 10" />
        <polyline points="1 20 1 14 7 14" />
        <path d="M3.51 9a9 9 0 0 1 14.88-3.36L23 10" />
        <path d="M20.49 15a9 9 0 0 1-14.88 3.36L1 14" />
      </svg>
    </button>
  )
}
