// Returns on-chain Uniswap V2 pool reserves as USD liquidity
const RPCS = [
  'https://ethereum.publicnode.com',
  'https://cloudflare-eth.com',
]
const KENDU_ETH_POOL = '0xd9f2a7471d1998c69de5cae6df5d3f070f01df9f'
const KENDU_POOL_CREATION_BLOCK = 19276187
const KENDU_POOL_CREATION_TIMESTAMP = 1708520387
const SYNC_TOPIC = '0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1'

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

async function etherscan(params) {
  const apiKey = process.env.ETHERSCAN_API_KEY
  if (!apiKey) throw new Error('Missing ETHERSCAN_API_KEY')
  const query = new URLSearchParams({ chainid: '1', apikey: apiKey, ...params })
  const response = await fetch(`https://api.etherscan.io/v2/api?${query}`, { cache: 'no-store' })
  if (!response.ok) throw new Error(`Etherscan returned ${response.status}`)
  return response.json()
}

function decodeSyncWeth(data) {
  if (!/^0x[0-9a-fA-F]{128}$/.test(data || '')) throw new Error('Invalid historical reserve data')
  return Number(BigInt(`0x${data.slice(66, 130)}`)) / 1e18
}

async function getHistoricalWeth(pool, timestamp) {
  const blockResult = await etherscan({
    module: 'block',
    action: 'getblocknobytime',
    timestamp: String(timestamp),
    closest: 'before',
  })
  const targetBlock = Number(blockResult?.result)
  if (blockResult?.status !== '1' || !Number.isInteger(targetBlock)) {
    throw new Error(blockResult?.result || 'Historical block unavailable')
  }
  if (targetBlock < KENDU_POOL_CREATION_BLOCK) throw new Error('Requested timeframe predates the KENDU pool')

  let span = 7200
  for (let attempt = 0; attempt < 7; attempt++) {
    const fromBlock = Math.max(KENDU_POOL_CREATION_BLOCK, targetBlock - span)
    const logsResult = await etherscan({
      module: 'logs',
      action: 'getLogs',
      fromBlock: String(fromBlock),
      toBlock: String(targetBlock),
      address: pool,
      topic0: SYNC_TOPIC,
      page: '1',
      offset: '1000',
    })
    const logs = Array.isArray(logsResult?.result) ? logsResult.result : []
    if (logs.length) {
      const latest = logs.reduce((best, log) => {
        const position = [Number.parseInt(log.blockNumber, 16), Number.parseInt(log.logIndex, 16)]
        const bestPosition = best
          ? [Number.parseInt(best.blockNumber, 16), Number.parseInt(best.logIndex, 16)]
          : [-1, -1]
        return position[0] > bestPosition[0] || (position[0] === bestPosition[0] && position[1] > bestPosition[1]) ? log : best
      }, null)
      return {
        wethAmount: decodeSyncWeth(latest.data),
        blockNumber: Number.parseInt(latest.blockNumber, 16),
        asOfTimestamp: Number.parseInt(latest.timeStamp, 16),
      }
    }
    if (logsResult?.status === '0' && !/no records/i.test(`${logsResult?.message || ''} ${logsResult?.result || ''}`)) {
      throw new Error(logsResult?.result || 'Historical reserves unavailable')
    }
    if (fromBlock === KENDU_POOL_CREATION_BLOCK) break
    span *= 4
  }
  throw new Error('No historical pool reserve found')
}

export default async function handler(req, res) {
  const { pool, timestamp } = req.query
  if (!pool) return res.status(400).json({ error: 'missing pool' })

  if (timestamp != null) {
    const targetTimestamp = Number(timestamp)
    if (pool.toLowerCase() !== KENDU_ETH_POOL || !Number.isInteger(targetTimestamp) ||
        targetTimestamp < KENDU_POOL_CREATION_TIMESTAMP || targetTimestamp > Math.floor(Date.now() / 1000)) {
      return res.status(400).json({ error: 'invalid historical reserve request' })
    }
    try {
      const historical = await getHistoricalWeth(pool, targetTimestamp)
      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600')
      return res.json(historical)
    } catch (err) {
      return res.status(500).json({ error: err.message || 'historical reserve lookup failed' })
    }
  }

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
  const reserve0 = BigInt('0x' + hex.slice(2, 66))
  const reserve1 = BigInt('0x' + hex.slice(66, 130))
  const kenduAmount = Number(reserve0) / 1e18
  const wethAmount = Number(reserve1) / 1e18

  const ethPrice = ethPriceRes.status === 'fulfilled' ? ethPriceRes.value?.ethereum?.usd : null
  if (!ethPrice) return res.status(500).json({ error: 'no eth price' })

  const liquidityUSD = wethAmount * ethPrice * 2
  res.json({ liquidityUSD, kenduAmount, wethAmount, ethPrice })
}
