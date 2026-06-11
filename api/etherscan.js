// api/etherscan.js
// Proxies Etherscan gas oracle. API key stored as environment variable,
// never exposed to the browser.
//
// Set in Vercel dashboard: ETHERSCAN_API_KEY = your key

export default async function handler(req, res) {
  const { module: mod, action } = req.query

  // Only allow safe read-only actions
  const ALLOWED_ACTIONS = ['gasoracle', 'ethprice']
  if (!ALLOWED_ACTIONS.includes(action)) {
    return res.status(400).json({ error: 'Action not permitted' })
  }

  const apiKey = process.env.ETHERSCAN_API_KEY || 'M5XZ6NDDYYQ5HY9KVUQDJ12ME484DVEP4A'
  const url = `https://api.etherscan.io/v2/api?chainid=1&module=${mod}&action=${action}&apikey=${apiKey}`

  try {
    const upstream = await fetch(url, { cache: 'no-store' })
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `Etherscan returned ${upstream.status}` })
    }
    const data = await upstream.json()
    res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=20')
    return res.status(200).json(data)
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Proxy error' })
  }
}
