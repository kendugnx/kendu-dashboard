// Fetches KENDU's rank within CMC's Meme Tokens category.
// Uses CMC Pro API (free Basic plan) with CMC_API_KEY env var.
// Falls back to CMC's public data API if no key is set.

const PRO_BASE    = 'https://pro-api.coinmarketcap.com'
const PUBLIC_BASE = 'https://api.coinmarketcap.com'

// CMC memecoins category ID (stable — tied to the "Meme Tokens" category page)
const MEME_CATEGORY_ID = '604f6d69edc2087cd5e5b05c'
const KENDU_SYMBOL     = 'KENDU'

async function proRank(apiKey) {
  // Fetch the memecoins category with up to 500 coins, sorted by market cap desc
  const url = `${PRO_BASE}/v1/cryptocurrency/category?id=${MEME_CATEGORY_ID}&limit=500&start=1`
  const res = await fetch(url, {
    headers: { 'X-CMC_PRO_API_KEY': apiKey, 'Accept': 'application/json' },
  })
  const json = await res.json()
  const coins = json?.data?.coins ?? []
  const idx   = coins.findIndex(c => c.symbol?.toUpperCase() === KENDU_SYMBOL)
  if (idx === -1) return null
  return { rank: idx + 1, total: coins.length, source: 'pro' }
}

async function publicRank() {
  // CMC public data API — same data their website uses, no key required
  const url = `${PUBLIC_BASE}/data-api/v3/cryptocurrency/category?categorySlug=meme-token&start=1&limit=500&convert=USD&sort=market_cap&direction=desc`
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    },
  })
  const json = await res.json()
  const coins = json?.data?.coinList ?? []
  const idx   = coins.findIndex(c => c.symbol?.toUpperCase() === KENDU_SYMBOL)
  if (idx === -1) return null
  return { rank: idx + 1, total: coins.length, source: 'public' }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600')
  try {
    const apiKey = process.env.CMC_API_KEY
    const result = apiKey ? await proRank(apiKey) : await publicRank()
    if (!result) return res.status(404).json({ error: 'KENDU not found in memecoins category' })
    return res.status(200).json(result)
  } catch (err) {
    return res.status(500).json({ error: err.message || 'CMC rank error' })
  }
}
