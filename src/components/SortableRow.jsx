import React from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import styles from './SortableRow.module.css'

export default function SortableRow({ id, className, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 999 : undefined,
  }

  return (
    <div ref={setNodeRef} style={style} className={`${styles.row} ${className || ''}`} {...attributes}>
      <div className={styles.dragBar} {...listeners} title="Drag to reorder">
        <svg viewBox="0 0 24 6" width="24" height="6" fill="currentColor">
          <circle cx="4" cy="3" r="1.5"/>
          <circle cx="12" cy="3" r="1.5"/>
          <circle cx="20" cy="3" r="1.5"/>
        </svg>
      </div>
      {children}
    </div>
  )
}
