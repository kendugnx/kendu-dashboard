const CA = '0xaa95f26e30001251fb905d264Aa7b00eE9dF6C18'

async function resolveENS(address) {
  try {
    const r = await fetch(`https://enstate.rs/a/${address}`, { signal: AbortSignal.timeout(3000) })
    if (!r.ok) return null
    const j = await r.json()
    return j.name || null
  } catch { return null }
}

export default async function handler(req, res) {
  const limit = Math.min(100, Math.max(10, parseInt(req.query.limit) || 25))
  try {
    const apiKey = process.env.ETHPLORER_API_KEY || 'freekey'
    const url = `https://api.ethplorer.io/getTopTokenHolders/${CA}?apiKey=${apiKey}&limit=${limit}`
    const r = await fetch(url)
    if (!r.ok) return res.status(r.status).json({ error: `Ethplorer returned ${r.status}` })
    const j = await r.json()
    if (!j.holders) return res.status(500).json({ error: j.error?.message || 'No holders data' })

    const ensNames = await Promise.all(j.holders.map(h => resolveENS(h.address)))
    const holders = j.holders.map((h, i) => ({ ...h, ens: ensNames[i] }))

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600')
    res.json(holders)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
