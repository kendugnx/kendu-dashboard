// api/cmc.js
// Proxies CoinMarketCap data-api calls server-side to avoid CORS.

export default async function handler(req, res) {
  const { path } = req.query
  if (!path) return res.status(400).json({ error: 'Missing path' })

  const url = `https://api.coinmarketcap.com${path}`

  try {
    const upstream = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      cache: 'no-store',
    })
    const data = await upstream.json()
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120')
    return res.status(200).json(data)
  } catch (err) {
    return res.status(500).json({ error: err.message || 'CMC proxy error' })
  }
}
