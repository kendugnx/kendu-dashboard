// api/telegram.js — Telegram bot webhook handler
const TOKEN = process.env.TELEGRAM_BOT_TOKEN

async function sendMessage(chatId, text) {
  await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  })
}

async function getPrice() {
  const [ethRes, kenduRes] = await Promise.all([
    fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd&include_24hr_change=true', { cache: 'no-store' }),
    fetch('https://api.dexscreener.com/latest/dex/tokens/0xaa95f26e30001251fb905d264Aa7b00eE9dF6C18', { cache: 'no-store' }),
  ])
  const ethJson   = await ethRes.json()
  const kenduJson = await kenduRes.json()
  const pair = (kenduJson?.pairs || []).find(p => p.chainId === 'ethereum') || kenduJson?.pairs?.[0]
  return {
    ethPrice:   ethJson.ethereum?.usd,
    ethChange:  ethJson.ethereum?.usd_24h_change,
    kenduPrice: pair?.priceUsd ? Number(pair.priceUsd) : null,
    kenduChange: pair?.priceChange?.h24 ? Number(pair.priceChange.h24) : null,
  }
}

async function getHolders() {
  const r = await fetch('https://kendu-dashboard.com/api/treasury', { cache: 'no-store' })
  const j = await r.json()
  return j
}

async function getMCap() {
  const r = await fetch(
    'https://api.dexscreener.com/latest/dex/tokens/0xaa95f26e30001251fb905d264Aa7b00eE9dF6C18',
    { cache: 'no-store' }
  )
  const j = await r.json()
  const pair = (j?.pairs || []).find(p => p.chainId === 'ethereum') || j?.pairs?.[0]
  return pair?.marketCap
}

function fmt(n) {
  if (!isFinite(n)) return '—'
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K'
  return '$' + n.toFixed(2)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).send('OK')

  const { message } = req.body || {}
  if (!message?.text) return res.status(200).send('OK')

  const chatId = message.chat.id
  const text   = message.text.trim().toLowerCase()

  try {
    if (text.startsWith('/start') || text.startsWith('/help')) {
      await sendMessage(chatId,
        `<b>Kendu Dashboard Bot</b>\n\n` +
        `Commands:\n` +
        `/price — ETH spot price\n` +
        `/mcap — Kendu market cap\n` +
        `/treasury — Treasury &amp; LP values\n` +
        `/holders — Holder counts\n` +
        `/dashboard — Open the dashboard`
      )

    } else if (text.startsWith('/price')) {
      const { ethPrice, ethChange, kenduChange } = await getPrice()
      const mc = await getMCap()
      const fmtChange = c => c == null ? '' : ` ${c > 0 ? '▲' : '▼'} ${Math.abs(c).toFixed(2)}% (24h)`
      const ethStr = ethPrice != null ? `$${ethPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'
      await sendMessage(chatId,
        `<b>ETH</b>  ${ethStr}${fmtChange(ethChange)}\n` +
        `<b>KENDU MC</b>  ${fmt(mc)}${fmtChange(kenduChange)}`
      )

    } else if (text.startsWith('/mcap')) {
      const { kenduChange } = await getPrice()
      const mc = await getMCap()
      const fmtChange = c => c == null ? '' : ` ${c > 0 ? '▲' : '▼'} ${Math.abs(c).toFixed(2)}% (24h)`
      await sendMessage(chatId, `<b>Kendu Market Cap</b>\n${fmt(mc)}${fmtChange(kenduChange)}`)

    } else if (text.startsWith('/treasury')) {
      const j = await getHolders()
      const lines = [`<b>Treasury &amp; Liquidity</b>`]
      if (j.treasury != null) lines.push(`Treasury: ${fmt(j.treasury)}`)
      if (j.lpEth    != null) lines.push(`ETH LP: ${fmt(j.lpEth)}`)
      if (j.lpBase   != null) lines.push(`Base LP: ${fmt(j.lpBase)}`)
      if (j.lpSol    != null) lines.push(`SOL LP: ${fmt(j.lpSol)}`)
      await sendMessage(chatId, lines.join('\n'))

    } else if (text.startsWith('/holders')) {
      // Pull from the holders CSV via the dashboard
      await sendMessage(chatId,
        `<b>Holder Counts</b>\nVisit the dashboard for live holder data:\nhttps://kendu-dashboard.com`
      )

    } else if (text.startsWith('/dashboard')) {
      await sendMessage(chatId,
        `<b>Kendu Dashboard</b>\nhttps://kendu-dashboard.com`
      )
    }
  } catch (e) {
    await sendMessage(chatId, 'Error fetching data. Try again in a moment.')
  }

  res.status(200).send('OK')
}
