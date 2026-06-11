// ---- Nice tick calculator for chart Y axis ----
export function niceTicks(min, max, target = 5) {
  const span  = Math.max(1, max - min)
  const step0 = span / target
  const pow   = Math.pow(10, Math.floor(Math.log10(step0)))
  const cands = [1, 2, 2.5, 5, 10].map(x => x * pow)
  let best = cands[0], diff = 1e9
  for (const s of cands) {
    const d = Math.abs(Math.ceil(span / s) - target)
    if (d < diff) { diff = d; best = s }
  }
  const niceMin = Math.floor(min / best) * best
  const niceMax = Math.ceil(max  / best) * best
  const ticks = []
  for (let v = niceMin; v <= niceMax + 1e-9; v += best) ticks.push(v)
  return { min: niceMin, max: niceMax, ticks }
}

// ---- Determine responsive padding from canvas width ----
// maxLabelWidth: measured pixel width of widest Y label (optional, for dynamic left pad)
export function responsivePad(wCss, maxLabelWidth = 0) {
  const narrow = wCss < 640
  const tiny   = wCss < 420
  const fontSize = tiny ? 12 : narrow ? 13 : 14
  // Dynamic left pad: label width + 16px margin, minimum 56px
  const l = Math.max(56, maxLabelWidth + 16)
  return {
    l,
    r: 26,
    t: narrow ? 14 : 20,
    b: narrow ? 40 : 44,
    axisFontSize: fontSize,
  }
}

// ---- Draw dashed Y-grid lines + labels ----
export function drawYGrid(ctx, ticks, pad, W, H, fmtFn, fontSize) {
  ctx.strokeStyle = '#5A5A5A'
  ctx.lineWidth   = 1
  ctx.setLineDash([4, 4])
  ctx.fillStyle   = '#E8E6EE'
  ctx.font        = `${fontSize}px 'Asap Condensed',system-ui,-apple-system,sans-serif`
  ctx.textAlign   = 'right'
  ctx.textBaseline = 'middle'

  const { min, max } = ticks
  const yScale = v => pad.t + H - ((v - min) / (max - min || 1)) * H

  for (const v of ticks.ticks) {
    const y = yScale(v)
    ctx.beginPath()
    ctx.moveTo(pad.l, y)
    ctx.lineTo(pad.l + W, y)
    ctx.stroke()
    ctx.fillText(fmtFn(v), pad.l - 8, y)
  }
  ctx.setLineDash([])
  return yScale
}

// ---- Draw X axis date labels ----
export function drawXLabels(ctx, series, xScale, pad, H, fontSize, plotW = 9999) {
  const N        = series.length
  const maxLbls  = Math.min(10, Math.max(3, Math.floor(plotW / 80)))
  const step     = Math.max(1, Math.ceil(N / maxLbls))
  const startIdx = Math.max(0, (N - 1) % step)

  ctx.fillStyle    = '#E6EDF3'
  ctx.font         = `${fontSize}px 'Asap Condensed',system-ui,-apple-system,sans-serif`
  ctx.textAlign    = 'center'
  ctx.textBaseline = 'alphabetic'

  const chartRight = pad.l + plotW
  for (let i = startIdx; i < N; i += step) {
    const d = series[i].d
    const rawX = xScale(i)
    // Clamp so last label doesn't clip right edge
    const x = Math.min(rawX, chartRight - 28)
    const top    = d.toLocaleString('en-US', { month: 'short' }).toUpperCase()
    const bottom = String(d.getDate()).padStart(2, '0') + ' ' + d.getFullYear()
    ctx.fillText(top,    x, pad.t + H + fontSize * 0.9 + 4)
    ctx.fillText(bottom, x, pad.t + H + fontSize * 1.9 + 4)
  }
}

// ---- Draw orange line ----
export function drawLine(ctx, xs, ys, xScale, yScale, color = '#F05C4E', width = 3) {
  if (!xs.length) return
  ctx.strokeStyle = color
  ctx.lineWidth   = width
  ctx.setLineDash([])
  ctx.beginPath()
  ctx.moveTo(xScale(0), yScale(ys[0]))
  for (let i = 1; i < xs.length; i++) ctx.lineTo(xScale(i), yScale(ys[i]))
  ctx.stroke()
}

// ---- Draw candlestick bar ---- 
export function drawBar(ctx, x, open, close, high, low, width = 4) {
  const isUp  = close >= open
  const color = isUp ? '#24c65b' : '#ff5e57'
  ctx.strokeStyle = color
  ctx.fillStyle   = color
  ctx.lineWidth   = 1

  // Wick
  ctx.beginPath()
  ctx.moveTo(x, high)
  ctx.lineTo(x, low)
  ctx.stroke()

  // Body
  const bodyTop = Math.min(open, close)
  const bodyH   = Math.max(1, Math.abs(close - open))
  ctx.fillRect(x - width / 2, bodyTop, width, bodyH)
}
