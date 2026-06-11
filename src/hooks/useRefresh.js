import { useState, useCallback } from 'react'
import { sleep } from '../utils/index.js'

const MIN_SPIN_MS = 900

/**
 * useRefresh(fetchFn)
 * Returns { spinning, trigger }
 * Call trigger() to run fetchFn with a minimum 0.9s spin animation.
 */
export function useRefresh(fetchFn) {
  const [spinning, setSpinning] = useState(false)

  const trigger = useCallback(async () => {
    if (spinning) return
    setSpinning(true)
    const started = performance.now()
    try {
      await fetchFn()
    } finally {
      const elapsed = performance.now() - started
      if (elapsed < MIN_SPIN_MS) await sleep(MIN_SPIN_MS - elapsed)
      setSpinning(false)
    }
  }, [fetchFn, spinning])

  return { spinning, trigger }
}
