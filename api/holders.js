const CA = '0xaa95f26e30001251fb905d264Aa7b00eE9dF6C18'

async function resolveENS(address) {
  try {
    const r = await fetch(`https://enstate.rs/a/${address}`, { signal: AbortSignal.timeout(3000) })
    if (!r.ok) return null
    const j = await r.json()
    return j.name || null
  } catch { return null }
}

// Batched eth_getCode + token0() probe in one RPC round-trip:
//  - isContract: address is backed by deployed bytecode (LPs, routers, bridges) —
//    used to exclude non-individual holders from HHI without a manual address list.
//  - isPool: address responds to the ERC20-pair `token0()` selector (0x0dfe1681),
//    which both Uniswap V2- and V3-style pools implement — flags AMM liquidity pools
//    generically, including ones never manually added to LPS/LABELS.
async function getOnchainFlags(addresses) {
  try {
    const batch = []
    addresses.forEach((addr, i) => {
      batch.push({ jsonrpc: '2.0', id: `code${i}`, method: 'eth_getCode', params: [addr, 'latest'] })
      batch.push({ jsonrpc: '2.0', id: `pool${i}`, method: 'eth_call', params: [{ to: addr, data: '0x0dfe1681' }, 'latest'] })
    })
    const r = await fetch('https://ethereum.publicnode.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batch),
      signal: AbortSignal.timeout(5000),
    })
    if (!r.ok) return addresses.map(() => ({ isContract: false, isPool: false }))
    const results = await r.json()
    const byId = new Map(results.map(item => [item.id, item.result]))
    return addresses.map((_, i) => {
      const code = byId.get(`code${i}`)
      const isContract = typeof code === 'string' && code !== '0x'
      const t0 = byId.get(`pool${i}`)
      const isPool = isContract && typeof t0 === 'string' && t0.length > 2
      return { isContract, isPool }
    })
  } catch {
    return addresses.map(() => ({ isContract: false, isPool: false }))
  }
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

    const [ensNames, onchainFlags] = await Promise.all([
      Promise.all(j.holders.map(h => resolveENS(h.address))),
      getOnchainFlags(j.holders.map(h => h.address)),
    ])
    const holders = j.holders.map((h, i) => ({
      ...h,
      ens: ensNames[i],
      isContract: onchainFlags[i].isContract,
      isPool: onchainFlags[i].isPool,
    }))

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600')
    res.json(holders)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
