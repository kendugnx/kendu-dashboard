// api/etherscan.js
// Proxies Etherscan gas oracle. API key stored as environment variable,
// never exposed to the browser.
//
// Set in Vercel dashboard: ETHERSCAN_API_KEY = your key

const ALLOWED_ACTIONS = new Set([
  'gasoracle', 'ethprice',
  'tokenbalance', 'tokentx', 'tokenholderlist',
])

export default async function handler(req, res) {
  const { module: mod, action, ...rest } = req.query

  if (!ALLOWED_ACTIONS.has(action)) {
    return res.status(400).json({ error: 'Action not permitted' })
  }

  const apiKey = process.env.ETHERSCAN_API_KEY || 'M5XZ6NDDYYQ5HY9KVUQDJ12ME484DVEP4A'
  const params = new URLSearchParams({ chainid: '1', module: mod, action, apikey: apiKey, ...rest })
  const url = `https://api.etherscan.io/v2/api?${params}`

  try {
    const upstream = await fetch(url, { cache: 'no-store' })
    if (!upstream.ok) return res.status(upstream.status).json({ error: `Etherscan returned ${upstream.status}` })
    const data = await upstream.json()
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60')
    return res.status(200).json(data)
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Proxy error' })
  }
}
