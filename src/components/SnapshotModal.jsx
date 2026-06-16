import React, { useState, useRef, useEffect, useCallback } from 'react'
import html2canvas from 'html2canvas'
import SnapshotCard from './SnapshotCard.jsx'
import styles from './SnapshotModal.module.css'

const CARD_WIDTH = 480

export default function SnapshotModal({ onClose }) {
  const [saving, setSaving]   = useState(false)
  const [sharing, setSharing] = useState(false)
  const [scale, setScale]     = useState(1)
  const [naturalH, setNaturalH] = useState(0)
  const cardRef                = useRef(null)
  const scaleOuterRef           = useRef(null)
  const scaleInnerRef           = useRef(null)
  const canShare               = typeof navigator !== 'undefined' && !!navigator.share

  // The card itself stays a fixed 480px wide (so the exported PNG is always
  // the same landscape shape regardless of device) -- on narrow viewports
  // we instead shrink it visually with a CSS transform on a wrapper, never
  // touching cardRef's own box, so html2canvas keeps capturing it at full
  // native resolution.
  useEffect(() => {
    const outer = scaleOuterRef.current
    const inner = scaleInnerRef.current
    if (!outer || !inner) return
    const update = () => {
      setScale(Math.min(1, outer.clientWidth / CARD_WIDTH))
      setNaturalH(inner.offsetHeight)
    }
    update()
    const ro1 = new ResizeObserver(update)
    const ro2 = new ResizeObserver(update)
    ro1.observe(outer)
    ro2.observe(inner)
    return () => { ro1.disconnect(); ro2.disconnect() }
  }, [])

  // html2canvas measures the card post-transform, so the visual fit-scale
  // applied above (for narrow viewports) would otherwise shrink the
  // exported resolution along with it. Compensate so the output stays a
  // consistent ~960px-wide image on every device.
  const renderCanvas = useCallback(() =>
    html2canvas(cardRef.current, { scale: 2 / (scale || 1), useCORS: true, backgroundColor: null, logging: false }),
  [scale])

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

        <div ref={scaleOuterRef} className={styles.cardScale} style={{ height: naturalH * scale || undefined }}>
          <div ref={scaleInnerRef} style={{ width: CARD_WIDTH, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
            <SnapshotCard ref={cardRef} />
          </div>
        </div>

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
