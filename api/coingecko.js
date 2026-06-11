// api/coingecko.js — server-side proxy to avoid browser rate limits on CoinGecko free tier
export default async function handler(req, res) {
  const qs   = new URL(req.url, 'http://localhost').searchParams
  const path = qs.get('path') || req.url.replace(/^\/api\/coingecko/, '')
  const url  = `https://api.coingecko.com/api/v3${path}`

  try {
    const upstream = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      cache: 'no-store',
    })
    const data = await upstream.json()
    if (upstream.status === 429) {
      return res.status(429).json({ error: 'CoinGecko rate limit' })
    }
    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300')
    return res.status(200).json(data)
  } catch (err) {
    return res.status(500).json({ error: err.message || 'CoinGecko proxy error' })
  }
}
