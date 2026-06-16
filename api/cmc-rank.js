// Returns KENDU's overall CMC rank and CoinGecko meme-token category rank.
// CMC: uses Pro API if CMC_API_KEY env var is set, else public data API.
// Meme rank: CoinGecko free API, category=meme-token, search up to page 3.

const CMC_PUBLIC  = 'https://api.coinmarketcap.com'
const CMC_PRO     = 'https://pro-api.coinmarketcap.com'
const KENDU_CMC_ID = 31152
const KENDU_CG_ID  = 'kendu-inu'

async function cmcOverallRank(apiKey) {
  if (apiKey) {
    const res  = await fetch(`${CMC_PRO}/v1/cryptocurrency/quotes/latest?id=${KENDU_CMC_ID}&convert=USD`, {
      headers: { 'X-CMC_PRO_API_KEY': apiKey, 'Accept': 'application/json' },
    })
    const json = await res.json()
    return json?.data?.[KENDU_CMC_ID]?.cmc_rank ?? null
  }
  const res  = await fetch(`${CMC_PUBLIC}/data-api/v3/cryptocurrency/detail?id=${KENDU_CMC_ID}&convert=USD`, {
    headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' },
  })
  const json = await res.json()
  return json?.data?.statistics?.rank ?? null
}

async function cgMemeRank() {
  for (let page = 1; page <= 3; page++) {
    const url  = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&category=meme-token&order=market_cap_desc&per_page=250&page=${page}`
    const res  = await fetch(url, { headers: { 'Accept': 'application/json' } })
    const list = await res.json()
    if (!Array.isArray(list) || list.length === 0) break
    const idx  = list.findIndex(c => c.id === KENDU_CG_ID)
    if (idx !== -1) return (page - 1) * 250 + idx + 1
  }
  return null
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600')
  try {
    const apiKey = process.env.CMC_API_KEY
    const [rank, memeRank] = await Promise.all([
      cmcOverallRank(apiKey).catch(() => null),
      cgMemeRank().catch(() => null),
    ])
    return res.status(200).json({ rank, memeRank })
  } catch (err) {
    return res.status(500).json({ error: err.message || 'rank error' })
  }
}
