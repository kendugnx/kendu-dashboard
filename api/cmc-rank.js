// Fetches KENDU's CMC rank from the public data API.
// Uses CMC Pro API when CMC_API_KEY env var is set (free Basic plan).
// Falls back to CMC's public data API (no key) otherwise.

const PRO_BASE    = 'https://pro-api.coinmarketcap.com'
const PUBLIC_BASE = 'https://api.coinmarketcap.com'
const KENDU_CMC_ID = 31152

async function proRank(apiKey) {
  const url  = `${PRO_BASE}/v1/cryptocurrency/quotes/latest?id=${KENDU_CMC_ID}&convert=USD`
  const res  = await fetch(url, {
    headers: { 'X-CMC_PRO_API_KEY': apiKey, 'Accept': 'application/json' },
  })
  const json = await res.json()
  const coin = json?.data?.[KENDU_CMC_ID]
  return coin?.cmc_rank ?? null
}

async function publicRank() {
  const url = `${PUBLIC_BASE}/data-api/v3/cryptocurrency/detail?id=${KENDU_CMC_ID}&convert=USD`
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    },
  })
  const json = await res.json()
  return json?.data?.statistics?.rank ?? null
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600')
  try {
    const apiKey = process.env.CMC_API_KEY
    const rank   = apiKey ? await proRank(apiKey) : await publicRank()
    return res.status(200).json({ rank })
  } catch (err) {
    return res.status(500).json({ error: err.message || 'CMC rank error' })
  }
}
