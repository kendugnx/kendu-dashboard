import React, { useState, useRef, useCallback } from 'react'
import html2canvas from 'html2canvas'
import SnapshotCard from './SnapshotCard.jsx'
import styles from './SnapshotModal.module.css'

export default function SnapshotModal({ onClose }) {
  const [saving, setSaving]   = useState(false)
  const [sharing, setSharing] = useState(false)
  const cardRef                = useRef(null)
  const canShare               = typeof navigator !== 'undefined' && !!navigator.share

  const renderCanvas = useCallback(() =>
    html2canvas(cardRef.current, { scale: 2, useCORS: true, backgroundColor: null, logging: false }),
  [])

  const download = useCallback(async () => {
    if (!cardRef.current) return
    setSaving(true)
    try {
      const canvas = await renderCanvas()
      const link = document.createElement('a')
      link.download = `kendu-${Date.now()}.png`
      link.href = canvas.toDataURL('image/png')
      link.click()
    } finally {
      setSaving(false)
    }
  }, [renderCanvas])

  const share = useCallback(async () => {
    if (!cardRef.current) return
    setSharing(true)
    try {
      const canvas = await renderCanvas()
      canvas.toBlob(async blob => {
        try {
          const file = new File([blob], 'kendu-snapshot.png', { type: 'image/png' })
          if (navigator.canShare?.({ files: [file] })) {
            await navigator.share({ files: [file], title: 'KENDU Snapshot' })
          } else {
            // Fallback: share URL only
            await navigator.share({ title: 'KENDU Snapshot', url: window.location.href })
          }
        } catch (e) {
          if (e.name !== 'AbortError') console.error('share failed:', e)
        } finally {
          setSharing(false)
        }
      }, 'image/png')
    } catch (e) {
      console.error('share render failed:', e)
      setSharing(false)
    }
  }, [renderCanvas])

  return (
    <div className={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>
        <div className={styles.modalHead}>
          <span className={styles.modalTitle}>SNAPSHOT</span>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        <SnapshotCard ref={cardRef} />

        <div className={styles.actions}>
          <button className={styles.iconBtn} onClick={download} disabled={saving || sharing} title="Download PNG">
            {saving
              ? <span className={styles.iconBtnSpinner} />
              : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
            }
          </button>
          {canShare && (
            <button className={styles.iconBtn} onClick={share} disabled={saving || sharing} title="Share">
              {sharing
                ? <span className={styles.iconBtnSpinner} />
                : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                    <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
                    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
                  </svg>
              }
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
