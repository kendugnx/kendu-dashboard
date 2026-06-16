// Fetches KENDU's rank within CMC's Meme Tokens category.
// Uses CMC Pro API when CMC_API_KEY env var is set (free Basic plan at pro.coinmarketcap.com).
// Falls back to CMC's public data API (no key) otherwise.

const PRO_BASE    = 'https://pro-api.coinmarketcap.com'
const PUBLIC_BASE = 'https://api.coinmarketcap.com'

// Stable CMC memecoins category ID (matches /view/meme-token/ page)
const MEME_CATEGORY_ID = '604f6d69edc2087cd5e5b05c'
const KENDU_SYMBOL     = 'KENDU'

async function proRank(apiKey) {
  const url = `${PRO_BASE}/v1/cryptocurrency/category?id=${MEME_CATEGORY_ID}&limit=500&start=1`
  const res  = await fetch(url, {
    headers: { 'X-CMC_PRO_API_KEY': apiKey, 'Accept': 'application/json' },
  })
  const json = await res.json()
  // Pro API: data.coins[]
  const coins = json?.data?.coins ?? []
  const idx   = coins.findIndex(c => c.symbol?.toUpperCase() === KENDU_SYMBOL)
  if (idx !== -1) return { rank: idx + 1, total: coins.length, source: 'pro' }
  return null
}

async function publicRank() {
  // CMC public data API — same source their website uses, no key required.
  // Fetch up to 1000 coins from the meme-token category sorted by market cap.
  const url = `${PUBLIC_BASE}/data-api/v3/cryptocurrency/category?id=${MEME_CATEGORY_ID}&start=1&limit=1000&convert=USD`
  const res  = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    },
  })
  const json = await res.json()
  // Public API: data.coinList[] or data.coins[] depending on version
  const coins = json?.data?.coinList ?? json?.data?.coins ?? []
  const idx   = coins.findIndex(c => c.symbol?.toUpperCase() === KENDU_SYMBOL)
  if (idx !== -1) return { rank: idx + 1, total: coins.length, source: 'public' }
  // Return debug info so we can see what fields came back
  return { rank: null, debug: { keys: Object.keys(json?.data ?? {}), count: coins.length, sample: coins[0] } }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600')
  try {
    const apiKey = process.env.CMC_API_KEY
    const result = apiKey ? await proRank(apiKey) : await publicRank()
    if (!result || result.rank == null) {
      return res.status(200).json({ rank: null, ...(result ?? {}) })
    }
    return res.status(200).json(result)
  } catch (err) {
    return res.status(500).json({ error: err.message || 'CMC rank error' })
  }
}
