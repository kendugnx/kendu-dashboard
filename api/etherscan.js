// api/etherscan.js
// Proxies Etherscan gas oracle. API key stored as environment variable,
// never exposed to the browser.
//
// Set in Vercel dashboard: ETHERSCAN_API_KEY = your key

const ALLOWED_ACTIONS = new Set([
  'gasoracle', 'ethprice',
  'tokenbalance', 'tokentx', 'tokenholderlist',
])

const ETH_RPC_URLS = [
  'https://ethereum.publicnode.com',
  'https://eth.llamarpc.com',
]

async function resolveTransactionWallets(transfers) {
  const hashes = [...new Set(transfers.map(tx => tx.hash).filter(Boolean))]
  if (!hashes.length) return transfers

  const payload = hashes.map((hash, index) => ({
    jsonrpc: '2.0',
    id: index + 1,
    method: 'eth_getTransactionByHash',
    params: [hash],
  }))

  for (const rpcUrl of ETH_RPC_URLS) {
    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!response.ok) continue

      const results = await response.json()
      if (!Array.isArray(results)) continue

      const wallets = new Map(results
        .map(item => item?.result)
        .filter(tx => tx?.hash && tx?.from)
        .map(tx => [tx.hash.toLowerCase(), tx.from]))

      return transfers.map(tx => ({
        ...tx,
        wallet: wallets.get(String(tx.hash).toLowerCase()) || null,
      }))
    } catch {
      // Try the next public RPC. The feed still works without wallet enrichment.
    }
  }

  return transfers
}

export default async function handler(req, res) {
  const { module: mod, action, resolvewallets, ...rest } = req.query

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
    if (action === 'tokentx' && resolvewallets === '1' && Array.isArray(data.result)) {
      data.result = await resolveTransactionWallets(data.result)
    }
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60')
    return res.status(200).json(data)
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Proxy error' })
  }
}
