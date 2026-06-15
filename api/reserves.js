// Returns on-chain Uniswap V2 pool reserves as USD liquidity
const RPCS = [
  'https://ethereum.publicnode.com',
  'https://cloudflare-eth.com',
]

async function ethCall(rpc, to, data) {
  const r = await fetch(rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_call', params: [{ to, data }, 'latest'], id: 1 }),
  })
  const j = await r.json()
  if (j.error || !j.result || j.result === '0x') throw new Error(j.error?.message || 'empty result')
  return j.result
}

async function getReservesWithFallback(pool) {
  for (const rpc of RPCS) {
    try {
      return await ethCall(rpc, pool, '0x0902f1ac')
    } catch {
      // try next
    }
  }
  throw new Error('all RPCs failed')
}

export default async function handler(req, res) {
  const { pool } = req.query
  if (!pool) return res.status(400).json({ error: 'missing pool' })

  const [hexResult, ethPriceRes] = await Promise.allSettled([
    getReservesWithFallback(pool),
    fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd').then(r => r.json()),
  ])

  if (hexResult.status === 'rejected') {
    return res.status(500).json({ error: hexResult.reason?.message })
  }

  const hex = hexResult.value
  // getReserves ABI: (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)
  // KENDU is token0 (0xaa95 < 0xc02a), WETH is token1
  const reserve1 = BigInt('0x' + hex.slice(66, 130))
  const wethAmount = Number(reserve1) / 1e18

  const ethPrice = ethPriceRes.status === 'fulfilled' ? ethPriceRes.value?.ethereum?.usd : null
  if (!ethPrice) return res.status(500).json({ error: 'no eth price' })

  const liquidityUSD = wethAmount * ethPrice * 2
  res.json({ liquidityUSD, wethAmount, ethPrice })
}
