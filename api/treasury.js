// api/treasury.js
// Fetches treasury wallet USD value (Ethplorer) and LP pool values (Dexscreener).
// All external calls happen server-side.

const TREASURY_WALLET = '0xD22849fcB4C83389E65a1c40748a9b67157638A3'
const LPS = {
  eth:  { chain: 'ethereum', address: '0xD9f2A7471d1998C69De5Cae6dF5d3f070F01DF9F' },
  base: { chain: 'base',     address: '0xFBFD0e1838A101a26FDB5D4ae0B4D17153eCA66B' },
  sol:  { chain: 'solana',   address: 'B34Pu6w8eecYRXLEDxBCPy5JoFLy3iycLAPJpYiwbKMK' },
}

async function fetchTreasuryUSD() {
  const url = `https://api.ethplorer.io/getAddressInfo/${TREASURY_WALLET}?apiKey=freekey`
  const r   = await fetch(url, { cache: 'no-store' })
  if (!r.ok) throw new Error(`Ethplorer ${r.status}`)
  const j   = await r.json()

  const ethBal   = Number(j?.ETH?.balance ?? 0)
  const ethPrice = Number(j?.ETH?.price?.rate ?? 0)
  let total      = ethBal * ethPrice

  for (const t of (j?.tokens ?? [])) {
    const bal   = Number(t.balance) / Math.pow(10, Number(t.tokenInfo?.decimals ?? 18))
    const price = Number(t.tokenInfo?.price?.rate ?? 0)
    if (isFinite(bal) && price > 0) total += bal * price
  }
  return isFinite(total) && total > 0 ? total : null
}

async function fetchLPUSD(chain, pairAddr) {
  const url = `https://api.dexscreener.com/latest/dex/pairs/${chain}/${pairAddr}`
  const r   = await fetch(url, { cache: 'no-store' })
  if (!r.ok) return null
  const j   = await r.json()
  const pair = Array.isArray(j?.pairs) ? j.pairs[0] : j?.pair
  const liq  = Number(pair?.liquidity?.usd)
  return isFinite(liq) && liq > 0 ? liq : null
}

export default async function handler(req, res) {
  try {
    const [treasury, lpEth, lpBase, lpSol] = await Promise.allSettled([
      fetchTreasuryUSD(),
      fetchLPUSD(LPS.eth.chain,  LPS.eth.address),
      fetchLPUSD(LPS.base.chain, LPS.base.address),
      fetchLPUSD(LPS.sol.chain,  LPS.sol.address),
    ])

    const result = {
      treasury: treasury.status === 'fulfilled' ? treasury.value : null,
      lpEth:    lpEth.status    === 'fulfilled' ? lpEth.value    : null,
      lpBase:   lpBase.status   === 'fulfilled' ? lpBase.value   : null,
      lpSol:    lpSol.status    === 'fulfilled' ? lpSol.value    : null,
    }

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120')
    return res.status(200).json(result)
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Treasury fetch failed' })
  }
}
