import React from 'react'
import SnapshotCard from './components/SnapshotCard.jsx'

// Bare render target for /embed/snapshot -- no modal chrome, just the card,
// screenshotted server-side by api/snapshot-image.js (headless Chromium)
// for the Telegram bot's /snapshot command. SnapshotCard sets data-ready
// once stats have loaded so the screenshotter knows when to fire.
export default function SnapshotEmbed() {
  return (
    <div style={{ display: 'inline-block', background: 'transparent' }}>
      <SnapshotCard />
    </div>
  )
}
