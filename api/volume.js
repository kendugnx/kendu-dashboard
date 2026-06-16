const POOL = '0xd9f2a7471d1998c69de5cae6df5d3f070f01df9f'
const BASE  = 'https://api.geckoterminal.com/api/v2'
const HDRS  = { 'Accept': 'application/json' }

export default async function handler(req, res) {
  const days = Math.min(365, Math.max(7, parseInt(req.query.days) || 90))

  try {
    const [ohlcvRes, poolRes] = await Promise.all([
      fetch(`${BASE}/networks/eth/pools/${POOL}/ohlcv/day?limit=${days}&currency=usd`, { headers: HDRS }),
      fetch(`${BASE}/networks/eth/pools/${POOL}`, { headers: HDRS }),
    ])

    if (!ohlcvRes.ok) return res.status(ohlcvRes.status).json({ error: `GeckoTerminal OHLCV returned ${ohlcvRes.status}` })
    const ohlcvJson = await ohlcvRes.json()
    const ohlcv = ohlcvJson?.data?.attributes?.ohlcv_list || []
    const candles = [...ohlcv]
      .sort((a, b) => a[0] - b[0])
      .map(([ts, , , , close, vol]) => ({
        date: ts,
        dailyVolumeUSD: String(vol),
        priceUSD: close,
      }))

    let volume24h = null
    if (poolRes.ok) {
      const poolJson = await poolRes.json()
      volume24h = poolRes.ok ? (poolJson?.data?.attributes?.volume_usd?.h24 ?? null) : null
    }

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600')
    res.json({ candles, volume24h })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
