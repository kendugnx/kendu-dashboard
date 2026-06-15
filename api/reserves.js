// Returns on-chain Uniswap V2 pool reserves as USD liquidity
export default async function handler(req, res) {
  const { pool } = req.query
  if (!pool) return res.status(400).json({ error: 'missing pool' })

  const [reserveRes, ethPriceRes] = await Promise.all([
    fetch('https://cloudflare-eth.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', method: 'eth_call',
        params: [{ to: pool, data: '0x0902f1ac' }, 'latest'],
        id: 1,
      }),
    }).then(r => r.json()),
    fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd')
      .then(r => r.json()),
  ])

  const hex = reserveRes.result
  if (!hex || hex === '0x') return res.status(500).json({ error: 'bad rpc response' })

  // KENDU is token0, WETH is token1
  const reserve1Wei = BigInt('0x' + hex.slice(66, 130))
  const wethAmount  = Number(reserve1Wei) / 1e18
  const ethPrice    = ethPriceRes?.ethereum?.usd

  if (!ethPrice) return res.status(500).json({ error: 'no eth price' })

  const liquidityUSD = wethAmount * ethPrice * 2
  res.json({ liquidityUSD, wethAmount, ethPrice })
}
