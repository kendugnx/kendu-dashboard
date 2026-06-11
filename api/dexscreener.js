// api/dexscreener.js
// Proxies Dexscreener API calls server-side.
// No key required for Dexscreener, but proxying avoids CORS issues
// and keeps the pattern consistent for future keyed APIs.

export default async function handler(req, res) {
  const { type, address, chain, pair } = req.query

  let url
  if (type === 'token') {
    url = `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(address)}`
  } else if (type === 'pair') {
    url = `https://api.dexscreener.com/latest/dex/pairs/${encodeURIComponent(chain)}/${encodeURIComponent(pair)}`
  } else {
    return res.status(400).json({ error: 'Invalid type. Use token or pair.' })
  }

  try {
    const upstream = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      cache: 'no-store',
    })
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `Dexscreener returned ${upstream.status}` })
    }
    const data = await upstream.json()
    // Cache for 30s on Vercel edge
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60')
    return res.status(200).json(data)
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Proxy error' })
  }
}
