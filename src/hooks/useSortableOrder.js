import { useState, useEffect, useCallback } from 'react'
import { arrayMove } from '@dnd-kit/sortable'

export const DESKTOP_ORDER = ['network', 'chart', 'holderPair', 'concentration', 'volume', 'feedPair', 'treasury', 'wallet', 'calculator', 'impact', 'links']
export const MOBILE_ORDER  = ['network', 'chart', 'milestone', 'composition', 'concentration', 'volume', 'board', 'feed', 'treasury', 'wallet', 'calculator', 'impact', 'links']

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    const saved = JSON.parse(raw)
    // ensure all default ids are present (handles new cards added later)
    const merged = [...saved.filter(id => fallback.includes(id)), ...fallback.filter(id => !saved.includes(id))]
    return merged
  } catch { return fallback }
}

function save(key, order) {
  try { localStorage.setItem(key, JSON.stringify(order)) } catch {}
}

export function useSortableOrder(isMobile) {
  const key = isMobile ? 'kd-order-mobile' : 'kd-order-desktop'
  const fallback = isMobile ? MOBILE_ORDER : DESKTOP_ORDER

  const [order, setOrder] = useState(() => load(key, fallback))

  useEffect(() => {
    setOrder(load(key, fallback))
  }, [key])

  const handleDragEnd = useCallback(({ active, over }) => {
    if (!over || active.id === over.id) return
    setOrder(prev => {
      const oldIdx = prev.indexOf(active.id)
      const newIdx = prev.indexOf(over.id)
      if (oldIdx === -1 || newIdx === -1) return prev
      const next = arrayMove(prev, oldIdx, newIdx)
      save(key, next)
      return next
    })
  }, [key])

  const resetOrder = useCallback(() => {
    try { localStorage.removeItem(key) } catch {}
    setOrder(fallback)
  }, [key, fallback])

  return { order, handleDragEnd, resetOrder }
}
