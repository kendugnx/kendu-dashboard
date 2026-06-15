// Fetches daily volume data for the KENDU/WETH pool from The Graph (Uniswap V2 subgraph)
const SUBGRAPH = 'https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v2'
const PAIR = '0xd9f2a7471d1998c69de5cae6df5d3f070f01df9f'

export default async function handler(req, res) {
  const days = Math.min(365, Math.max(7, parseInt(req.query.days) || 90))

  const query = `{
    pairDayDatas(
      first: ${days}
      orderBy: date
      orderDirection: desc
      where: { pairAddress: "${PAIR}" }
    ) {
      date
      dailyVolumeUSD
      reserveUSD
      token0Price
    }
  }`

  try {
    const r = await fetch(SUBGRAPH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    })
    const j = await r.json()
    if (j.errors) return res.status(500).json({ error: j.errors[0]?.message })
    const data = j?.data?.pairDayDatas || []
    const sorted = [...data].sort((a, b) => a.date - b.date)
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600')
    res.json(sorted)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
