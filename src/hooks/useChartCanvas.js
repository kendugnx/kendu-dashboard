import { useRef, useEffect, useCallback } from 'react'

/**
 * useChartCanvas(drawFn, deps)
 * drawFn receives (ctx, width, height) in CSS pixels.
 * Returns { canvasRef, wrapRef }
 */
export function useChartCanvas(drawFn, deps = []) {
  const canvasRef = useRef(null)
  const wrapRef   = useRef(null)

  const resize = useCallback(() => {
    const canvas = canvasRef.current
    const wrap   = wrapRef.current
    if (!canvas || !wrap) return
    const wCss = wrap.clientWidth
    const hCss = canvas.dataset.height ? parseInt(canvas.dataset.height) : 320
    const dpr  = Math.max(1, Math.min(3, window.devicePixelRatio || 1))
    canvas.style.width  = wCss + 'px'
    canvas.style.height = hCss + 'px'
    canvas.width  = Math.floor(wCss * dpr)
    canvas.height = Math.floor(hCss * dpr)
    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, wCss, hCss)
    drawFn(ctx, wCss, hCss)
  }, [drawFn])

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)
    resize()
    window.addEventListener('resize', resize)
    return () => { ro.disconnect(); window.removeEventListener('resize', resize) }
  }, [resize, ...deps])

  return { canvasRef, wrapRef }
}
