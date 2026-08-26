#!/usr/bin/env node

import { createServer } from 'node:http'
import { basename, dirname } from 'node:path'

await loadDotenv()

const SUPPLY = 996.74e9
const KENDU_ETH_CA = '0xaa95f26e30001251fb905d264Aa7b00eE9dF6C18'
const KENDU_BASE_CA = '0xef73611F98DA6E57e0776317957af61B59E09Ed7'
const KENDU_SOL_MINT = '2nnrviYJRLcf2bXAxpKTRXzccoDbwaP4vzuGUG75Jo45'
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

const CHAINS = {
  eth: {
    label: 'ETH',
    icon: '⚫',
    type: 'evm',
    geckoNetwork: 'eth',
    token: KENDU_ETH_CA,
    decimals: 18,
    rpcEnv: 'BUY_BOT_ETH_RPC_URL',
    defaultRpcUrl: 'https://ethereum-rpc.publicnode.com',
    pool: '0xd9f2a7471d1998c69de5cae6df5d3f070f01df9f',
    wrappedSymbol: 'ETH',
    txUrl: hash => `https://etherscan.io/tx/${hash}`,
    walletUrl: wallet => `https://etherscan.io/address/${wallet}`,
    dexToolsUrl: 'https://www.dextools.io/app/en/ether/pair-explorer/0xd9f2a7471d1998c69de5cae6df5d3f070f01df9f',
    dexScreenerUrl: 'https://dexscreener.com/ethereum/0xd9f2a7471d1998c69de5cae6df5d3f070f01df9f',
  },
  base: {
    label: 'BASE',
    icon: '🔵',
    type: 'evm',
    geckoNetwork: 'base',
    token: KENDU_BASE_CA,
    decimals: 18,
    rpcEnv: 'BUY_BOT_BASE_RPC_URL',
    defaultRpcUrl: 'https://mainnet.base.org',
    pool: '0xfbfd0e1838a101a26fdb5d4ae0b4d17153eca66b',
    wrappedSymbol: 'ETH',
    txUrl: hash => `https://basescan.org/tx/${hash}`,
    walletUrl: wallet => `https://basescan.org/address/${wallet}`,
    dexToolsUrl: 'https://www.dextools.io/app/en/base/pair-explorer/0xfbfd0e1838a101a26fdb5d4ae0b4d17153eca66b',
    dexScreenerUrl: 'https://dexscreener.com/base/0xfbfd0e1838a101a26fdb5d4ae0b4d17153eca66b',
  },
  sol: {
    label: 'SOL',
    icon: '🟣',
    type: 'solana',
    geckoNetwork: 'solana',
    token: KENDU_SOL_MINT,
    rpcEnv: 'BUY_BOT_SOL_RPC_URL',
    defaultRpcUrl: 'https://api.mainnet-beta.solana.com',
    pool: 'B34Pu6w8eecYRXLEDxBCPy5JoFLy3iycLAPJpYiwbKMK',
    wrappedSymbol: 'SOL',
    txUrl: hash => `https://solscan.io/tx/${hash}`,
    walletUrl: wallet => `https://solscan.io/account/${wallet}`,
    dexToolsUrl: 'https://www.dextools.io/app/en/solana/pair-explorer/B34Pu6w8eecYRXLEDxBCPy5JoFLy3iycLAPJpYiwbKMK',
    dexScreenerUrl: 'https://dexscreener.com/solana/b34pu6w8eecyrxledxbcpy5jofly3iyclapjpyiwbkmk',
  },
}

const TIERS = [
  { name: 'Seaweed', emoji: '🌿', emojiId: '5832357677191141172', min: 0, max: 1e6 },
  { name: 'Plankton', emoji: '🦠', emojiId: '5832427964330941051', min: 1e6, max: 5e6 },
  { name: 'Shrimp', emoji: '🦐', emojiId: '5834823160217737467', min: 5e6, max: 10e6 },
  { name: 'Magikarp', emoji: '🐡', emojiId: '5832615323689293877', min: 10e6, max: 20e6 },
  { name: 'Crab', emoji: '🦀', emojiId: '5834769954162874792', min: 20e6, max: 35e6 },
  { name: 'Sardine', emoji: '🎣', emojiId: '5832239986497296976', min: 35e6, max: 50e6 },
  { name: 'Stingray', emoji: '🐭', emojiId: '5834456971306079760', min: 50e6, max: 75e6 },
  { name: 'Octopus', emoji: '🐙', emojiId: '5832565811306305131', min: 75e6, max: 100e6 },
  { name: 'Dolphin', emoji: '🐬', emojiId: '5832477072987002095', min: 100e6, max: 150e6 },
  { name: 'Barracuda', emoji: '🐟', emojiId: '5832657547512780826', min: 150e6, max: 200e6 },
  { name: 'Shark', emoji: '🦈', emojiId: '5834936242411673204', min: 200e6, max: 300e6 },
  { name: 'Orca', emoji: '🐠', emojiId: '5832579447827470721', min: 300e6, max: 400e6 },
  { name: 'Swordfish', emoji: '🗡', emojiId: '5832287132353305493', min: 400e6, max: 500e6 },
  { name: 'Whale', emoji: '🐳', emojiId: '5834535526257925548', min: 500e6, max: 700e6 },
  { name: 'Leviathan', emoji: '🐉', emojiId: '5832266593819695132', min: 700e6, max: 900e6 },
  { name: 'Kraken', emoji: '🦑', emojiId: '5832492358775610203', min: 900e6, max: 1.2e9 },
  { name: 'Chadasaurus', displayName: 'Chadadaurus', emoji: '🦖', emojiId: '5832696885118246980', min: 1.2e9, max: 1.6e9 },
  { name: 'Megalodon', emoji: '🐋', emojiId: '5834535625042172834', min: 1.6e9, max: 2.3e9 },
  { name: 'Gyarados', emoji: '🐲', emojiId: '5834903415976631260', min: 2.3e9, max: 3.5e9 },
  { name: 'Godwhale', emoji: '🌌', emojiId: '5832677931427567261', min: 3.5e9, max: 4.5e9 },
  { name: 'Eternal', displayName: 'Kendu Eternal', emoji: '🔥', emojiId: '5832546367989356475', min: 4.5e9, max: Infinity },
]

const args = new Set(process.argv.slice(2))
const watchMode = args.has('--watch')
const dryRun = args.has('--dry-run') || process.env.BUY_BOT_DRY_RUN === '1'
const pollMs = Number(process.env.BUY_BOT_POLL_MS || 15000)
const stateFile = process.env.BUY_BOT_STATE_FILE || '.buy-bot-state.json'
let healthServer
const chains = (process.env.BUY_BOT_CHAINS || 'eth,base,sol')
  .split(',')
  .map(chain => chain.trim().toLowerCase())
  .filter(chain => CHAINS[chain])

if (!chains.length) throw new Error('No valid chains configured')

async function main() {
  if (watchMode) startHealthServer()

  const state = await readState()
  await pollAllChains(state, { announceHistorical: args.has('--announce-existing') })
  await writeState(state)

  if (!watchMode) return

  setInterval(async () => {
    try {
      const nextState = await readState()
      await pollAllChains(nextState, { announceHistorical: false })
      await writeState(nextState)
    } catch (err) {
      console.error(`[buy-bot] ${err.stack || err.message}`)
    }
  }, pollMs)
}

function startHealthServer() {
  const port = Number(process.env.PORT || 0)
  if (!port) return

  healthServer = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, service: 'kendu-buy-bot' }))
  })
  healthServer.listen(port, '0.0.0.0', () => {
    console.log(`[buy-bot] health server listening on ${port}`)
  })
}

function shutdown(signal) {
  console.log(`[buy-bot] received ${signal}, shutting down`)
  if (!healthServer) process.exit(0)
  healthServer.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 5000)
}

async function pollAllChains(state, options) {
  const marketCap = await fetchKenduMarketCap()
  for (const chainKey of chains) {
    try {
      await pollChain(chainKey, state, options, marketCap)
    } catch (err) {
      console.error(`[${CHAINS[chainKey].label}] ${err.message}`)
    }
    await sleep(Number(process.env.BUY_BOT_CHAIN_DELAY_MS || 1000))
  }
}

async function pollChain(chainKey, state, { announceHistorical }, marketCap) {
  const chain = CHAINS[chainKey]
  const trades = await fetchTrades(chain)

  const buys = trades
    .map(trade => normalizeTrade(chainKey, chain, trade, marketCap))
    .filter(Boolean)
    .filter(event => event.usd >= minUsd(chainKey))
    .sort((a, b) => a.timestamp - b.timestamp)

  const latestId = buys.at(-1)?.id
  if (!state.seen) state.seen = {}
  if (!state.recent) state.recent = []

  if (!state.seen[chainKey]) {
    if (announceHistorical) {
      const samples = buys.slice(-3)
      for (const event of samples) {
        await enrichWalletTier(event)
        await announceBuy(event)
        state.recent.push(publicEvent(event))
      }
    }
    if (latestId) state.seen[chainKey] = latestId
    console.log(`[${chain.label}] primed ${buys.length} buys; latest=${latestId || 'none'}`)
    return
  }

  const lastSeen = state.seen[chainKey]
  const lastSeenIndex = buys.findIndex(event => event.id === lastSeen)
  if (lastSeenIndex === -1) {
    if (latestId) state.seen[chainKey] = latestId
    console.log(`[${chain.label}] resynced ${buys.length} buys; latest=${latestId || 'none'}`)
    return
  }

  const recentIds = new Set(state.recent.map(event => event.id))
  const newBuys = buys.slice(lastSeenIndex + 1).filter(event => !recentIds.has(event.id))

  if (!newBuys.length) {
    console.log(`[${chain.label}] no new buys`)
    return
  }

  for (const event of newBuys) {
    await enrichWalletTier(event)
    await announceBuy(event)
    state.recent.push(publicEvent(event))
  }

  state.seen[chainKey] = newBuys.at(-1).id
  state.recent = state.recent.slice(-500)
  console.log(`[${chain.label}] processed ${newBuys.length} new buys`)
}

async function fetchTrades(chain) {
  const url = `https://api.geckoterminal.com/api/v2/networks/${chain.geckoNetwork}/pools/${chain.pool}/trades?limit=100`
  const json = await getJSON(url)
  return Array.isArray(json.data) ? json.data : []
}

async function fetchKenduMarketCap() {
  const url = `https://api.dexscreener.com/latest/dex/tokens/${KENDU_ETH_CA}`
  const json = await getJSON(url)
  const pair = (json.pairs || []).find(item => item.chainId === 'ethereum') || json.pairs?.[0]
  return Number(pair?.marketCap || pair?.fdv || 0)
}

async function getJSON(url, tries = 3) {
  let lastStatus = 0
  for (let attempt = 1; attempt <= tries; attempt++) {
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (res.ok) return res.json()
    lastStatus = res.status
    if (res.status !== 429 && res.status < 500) break
    await sleep(750 * attempt)
  }
  throw new Error(`${url} returned ${lastStatus}`)
}

function normalizeTrade(chainKey, chain, trade, marketCap) {
  const attr = trade.attributes || {}
  if (attr.kind !== 'buy') return null

  const tokens = Number(attr.to_token_amount)
  const spentNative = Number(attr.from_token_amount)
  const usd = Number(attr.volume_in_usd)
  const priceUsd = Number(attr.price_to_in_usd)
  const currentMarketCap = Number(marketCap || priceUsd * SUPPLY)
  const timestamp = Date.parse(attr.block_timestamp)
  if (!isFinite(tokens) || !isFinite(usd) || !isFinite(timestamp)) return null

  return {
    id: trade.id || `${chainKey}:${attr.tx_hash}`,
    chainKey,
    chain: chain.label,
    chainIcon: chain.icon,
    hash: attr.tx_hash,
    wallet: attr.tx_from_address,
    tokens,
    spentNative,
    spentSymbol: chain.wrappedSymbol,
    usd,
    priceUsd,
    marketCap: currentMarketCap,
    timestamp,
    txUrl: chain.txUrl(attr.tx_hash),
    walletUrl: chain.walletUrl(attr.tx_from_address),
    dexToolsUrl: chain.dexToolsUrl,
    dexScreenerUrl: chain.dexScreenerUrl,
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function enrichWalletTier(event) {
  const chain = CHAINS[event.chainKey]
  if (!chain || !event.wallet) {
    event.tierText = tierLabel(tierForTokens(event.tokens))
    return
  }

  try {
    const recipient = await resolveTokenRecipient(chain, event)
    if (recipient) {
      event.wallet = recipient.wallet
      event.walletUrl = chain.walletUrl(recipient.wallet)
      if (isFinite(recipient.preBalance) && isFinite(recipient.postBalance)) {
        event.preBalance = recipient.preBalance
        event.postBalance = recipient.postBalance
        event.tierText = tierTransitionText(recipient.preBalance, recipient.postBalance)
        return
      }
    }

    const postBalance = await fetchWalletTokenBalance(chain, event.wallet)
    if (!isFinite(postBalance)) throw new Error('missing wallet balance')
    if (postBalance + 1 < event.tokens * 0.5) {
      event.postBalance = postBalance
      event.tierText = `Current Tier: ${tierLabel(tierForBalance(postBalance))}`
      return
    }

    const preBalance = Math.max(0, postBalance - event.tokens)
    event.postBalance = postBalance
    event.preBalance = preBalance
    event.tierText = tierTransitionText(preBalance, postBalance)
  } catch (err) {
    console.error(`[${chain.label}] wallet balance unavailable for ${event.wallet}: ${err.message}`)
    event.tierText = `Current Tier Unavailable`
  }
}

async function resolveTokenRecipient(chain, event) {
  if (chain.type === 'evm') return resolveEvmTokenRecipient(chain, event)
  if (chain.type === 'solana') return resolveSolanaTokenRecipient(chain, event)
  return null
}

async function resolveEvmTokenRecipient(chain, event) {
  if (!event.hash) return null
  const receipt = await postRPC(rpcUrl(chain), {
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_getTransactionReceipt',
    params: [event.hash],
  })
  const transfers = (receipt?.logs || [])
    .filter(log => log.address?.toLowerCase() === chain.token.toLowerCase())
    .filter(log => log.topics?.[0]?.toLowerCase() === TRANSFER_TOPIC)
    .map(log => ({
      from: `0x${log.topics[1].slice(-40)}`,
      wallet: `0x${log.topics[2].slice(-40)}`,
      amount: unitsToNumber(log.data, chain.decimals),
    }))
    .filter(item => isFinite(item.amount) && item.amount > 0)
    .filter(item => Math.abs(item.amount - event.tokens) <= Math.max(5, event.tokens * 0.02))

  const transferSources = new Set(transfers.map(item => item.from.toLowerCase()))
  const terminalTransfers = transfers.filter(item => !transferSources.has(item.wallet.toLowerCase()))
  const candidates = (terminalTransfers.length ? terminalTransfers : transfers)
    .filter(item => item.wallet.toLowerCase() !== chain.pool.toLowerCase())
    .sort((a, b) => Math.abs(a.amount - event.tokens) - Math.abs(b.amount - event.tokens))

  return candidates[0] ? { wallet: candidates[0].wallet } : null
}

async function resolveSolanaTokenRecipient(chain, event) {
  if (!event.hash) return null
  const tx = await postRPC(rpcUrl(chain), {
    jsonrpc: '2.0',
    id: 1,
    method: 'getTransaction',
    params: [
      event.hash,
      {
        encoding: 'jsonParsed',
        maxSupportedTransactionVersion: 0,
      },
    ],
  })
  const preByIndex = new Map((tx?.meta?.preTokenBalances || [])
    .filter(item => item.mint === chain.token)
    .map(item => [item.accountIndex, tokenUiAmount(item)]))
  const candidates = (tx?.meta?.postTokenBalances || [])
    .filter(item => item.mint === chain.token && item.owner)
    .map(item => {
      const postBalance = tokenUiAmount(item)
      const preBalance = preByIndex.get(item.accountIndex) || 0
      return {
        wallet: item.owner,
        preBalance,
        postBalance,
        delta: postBalance - preBalance,
      }
    })
    .filter(item => item.delta > 0)
    .sort((a, b) => Math.abs(a.delta - event.tokens) - Math.abs(b.delta - event.tokens))

  return candidates[0] || null
}

async function fetchWalletTokenBalance(chain, wallet) {
  if (chain.type === 'evm') return fetchEvmTokenBalance(chain, wallet)
  if (chain.type === 'solana') return fetchSolanaTokenBalance(chain, wallet)
  return null
}

async function fetchEvmTokenBalance(chain, wallet) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) return null
  const data = `0x70a08231${wallet.slice(2).padStart(64, '0')}`
  const result = await postRPC(rpcUrl(chain), {
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_call',
    params: [{ to: chain.token, data }, 'latest'],
  })
  if (!/^0x[0-9a-fA-F]+$/.test(result || '')) return null
  return Number(BigInt(result)) / 10 ** chain.decimals
}

async function fetchSolanaTokenBalance(chain, wallet) {
  const result = await postRPC(rpcUrl(chain), {
    jsonrpc: '2.0',
    id: 1,
    method: 'getTokenAccountsByOwner',
    params: [
      wallet,
      { mint: chain.token },
      { encoding: 'jsonParsed' },
    ],
  })
  const accounts = result?.value || []
  return accounts.reduce((sum, account) => {
    const amount = account?.account?.data?.parsed?.info?.tokenAmount?.uiAmount
    return sum + (Number(amount) || 0)
  }, 0)
}

async function postRPC(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok || json?.error) throw new Error(json?.error?.message || `RPC returned ${res.status}`)
  return json?.result
}

function rpcUrl(chain) {
  return process.env[chain.rpcEnv] || chain.defaultRpcUrl
}

function tierTransitionText(preBalance, postBalance) {
  const preTier = tierForBalance(preBalance)
  const postTier = tierForBalance(postBalance)
  if (!postTier) return 'Current Tier Unavailable'
  if (preBalance <= 0) return `New Holder -> ${tierLabel(postTier)}`
  if (preTier?.name !== postTier.name) return `${preTier ? tierLabel(preTier) : 'None'} -> ${tierLabel(postTier)}`
  return `Current Tier: ${tierLabel(postTier)}`
}

function tierForBalance(tokens) {
  if (!isFinite(tokens) || tokens <= 0) return null
  return tierForTokens(tokens)
}

function unitsToNumber(hex, decimals) {
  if (!/^0x[0-9a-fA-F]+$/.test(hex || '')) return null
  return Number(BigInt(hex)) / 10 ** decimals
}

function tokenUiAmount(item) {
  const amount = item?.uiTokenAmount?.uiAmount
  if (amount != null) return Number(amount) || 0
  const raw = item?.uiTokenAmount?.amount
  const decimals = item?.uiTokenAmount?.decimals
  if (raw == null || decimals == null) return 0
  return Number(BigInt(raw)) / 10 ** Number(decimals)
}


async function announceBuy(event) {
  const text = formatBuyAlert(event)
  if (dryRun || !process.env.TELEGRAM_BOT_TOKEN || !process.env.BUY_BOT_CHAT_ID) {
    console.log('\n--- BUY ALERT DRY RUN ---')
    console.log(text.replace(/<[^>]+>/g, ''))
    console.log('--- END ---\n')
    return
  }

  const media = await buyMedia(event.chainKey)
  if (media?.type === 'local') {
    await sendTelegramMultipart('sendVideo', {
      chat_id: process.env.BUY_BOT_CHAT_ID,
      video: media.path,
      caption: text,
      parse_mode: 'HTML',
      supports_streaming: true,
      width: 1920,
      height: 1080,
    })
  } else if (media?.type === 'url') {
    await sendTelegram('sendVideo', {
      chat_id: process.env.BUY_BOT_CHAT_ID,
      video: media.url,
      caption: text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      supports_streaming: true,
      width: 1920,
      height: 1080,
    })
  } else {
    await sendTelegram('sendMessage', {
      chat_id: process.env.BUY_BOT_CHAT_ID,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    })
  }
}

async function buyMedia(chainKey) {
  const chainEnv = process.env[`BUY_BOT_${chainKey.toUpperCase()}_MEDIA_URL`]
  if (mediaDisabled(chainEnv)) return null
  if (chainEnv) return { type: 'url', url: chainEnv }
  if (mediaDisabled(process.env.BUY_BOT_MEDIA_URL)) return null
  if (process.env.BUY_BOT_MEDIA_URL) return { type: 'url', url: process.env.BUY_BOT_MEDIA_URL }

  const localPath = {
    eth: 'public/BUY_ETH.mp4',
    base: 'public/BUY_BASE.mp4',
    sol: 'public/BUY_SOL.mp4',
  }[chainKey]
  if (localPath && await fileExists(localPath)) return { type: 'local', path: localPath }

  const fallbackUrl = {
    eth: 'https://kendu-dashboard.com/BUY_ETH.mp4',
    base: 'https://kendu-dashboard.com/BUY_BASE.mp4',
    sol: 'https://kendu-dashboard.com/BUY_SOL.mp4',
  }[chainKey]
  return fallbackUrl ? { type: 'url', url: fallbackUrl } : null
}

function mediaDisabled(value) {
  return /^(false|0|off|none|disabled)$/i.test(String(value || '').trim())
}

async function fileExists(path) {
  try {
    await import('node:fs/promises').then(fs => fs.access(path))
    return true
  } catch {
    return false
  }
}

async function sendTelegram(method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok || !json?.ok) throw new Error(json?.description || `Telegram ${method} failed`)
}

async function sendTelegramMultipart(method, payload) {
  const fs = await import('node:fs/promises')
  const form = new FormData()
  for (const [key, value] of Object.entries(payload)) {
    if (key === 'video') {
      const bytes = await fs.readFile(value)
      form.append(key, new Blob([bytes], { type: 'video/mp4' }), basename(value))
    } else {
      form.append(key, String(value))
    }
  }

  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    body: form,
  })
  const json = await res.json().catch(() => null)
  if (!res.ok || !json?.ok) throw new Error(json?.description || `Telegram ${method} failed`)
}

function formatBuyAlert(event) {
  return [
    `<b>Kendu Buy! (${event.chainIcon} ${event.chain})</b>`,
    '',
    buyIndicatorBar(event.usd),
    '',
    `🔀 Spent: <b>${fmtUSD(event.usd)}</b>${isFinite(event.spentNative) ? ` (${fmtNative(event.spentNative)} ${event.spentSymbol})` : ''}`,
    `🔀 Got: <b>${fmtTokens(event.tokens)} Kendu</b>`,
    `👤 <a href="${event.walletUrl}">Wallet</a> / <a href="${event.txUrl}">TX</a>`,
    `💼 <b>${event.tierText || 'Current Tier Unavailable'}</b>`,
    `🏦 Market Cap: <b>${fmtUSD(event.marketCap)}</b>`,
    '',
    `📊 <a href="${event.dexToolsUrl}">DEXTools</a> | <a href="${event.dexScreenerUrl}">DEXScreener</a>`,
  ].join('\n')
}

function buyIndicatorBar(usd) {
  const emoji = buyIndicator()
  const count = Math.max(1, Math.min(24, Math.ceil(usd / Number(process.env.BUY_BOT_EMOJI_USD || 50))))
  return emoji.repeat(count)
}

function buyIndicator() {
  const customEmojiId = String(process.env.BUY_BOT_CUSTOM_EMOJI_ID || '').trim()
  const fallbackEmoji = process.env.BUY_BOT_EMOJI || '🪙'
  if (/^\d{10,30}$/.test(customEmojiId)) {
    return `<tg-emoji emoji-id="${customEmojiId}">${escapeHTML(fallbackEmoji)}</tg-emoji>`
  }
  return escapeHTML(fallbackEmoji)
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]))
}

function tierForTokens(tokens) {
  return TIERS.find(t => tokens >= t.min && tokens < t.max) || TIERS[TIERS.length - 1]
}

function tierLabel(tier) {
  if (!tier) return 'None'
  const name = escapeHTML(tier.displayName || tier.name)
  const emoji = customEmoji(tier.emojiId, tier.emoji)
  return `${emoji} ${name}`
}

function customEmoji(emojiId, fallbackEmoji) {
  if (/^\d{10,30}$/.test(String(emojiId || ''))) {
    return `<tg-emoji emoji-id="${emojiId}">${escapeHTML(fallbackEmoji)}</tg-emoji>`
  }
  return escapeHTML(fallbackEmoji || '')
}

function minUsd(chainKey) {
  return Number(process.env[`BUY_BOT_${chainKey.toUpperCase()}_MIN_USD`] || process.env.BUY_BOT_MIN_USD || 5)
}

function fmtUSD(n) {
  if (!isFinite(n)) return '$0'
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: n >= 1000 ? 0 : 2, maximumFractionDigits: n >= 1000 ? 0 : 2 })
}

function fmtTokens(n) {
  if (!isFinite(n)) return '0'
  return Math.round(n).toLocaleString('en-US')
}

function fmtNative(n) {
  if (!isFinite(n)) return '0'
  return n.toLocaleString('en-US', { maximumFractionDigits: 6 })
}

function publicEvent(event) {
  const { id, chainKey, chain, hash, wallet, tokens, usd, marketCap, timestamp, txUrl, walletUrl, dexScreenerUrl, preBalance, postBalance, tierText } = event
  return { id, chainKey, chain, hash, wallet, tokens, usd, marketCap, timestamp, txUrl, walletUrl, dexScreenerUrl, preBalance, postBalance, tierText }
}

async function readState() {
  try {
    const text = await import('node:fs/promises').then(fs => fs.readFile(stateFile, 'utf8'))
    return JSON.parse(text)
  } catch {
    return { seen: {}, recent: [] }
  }
}

async function writeState(state) {
  const fs = await import('node:fs/promises')
  await fs.mkdir(dirname(stateFile), { recursive: true })
  await fs.writeFile(stateFile, JSON.stringify(state, null, 2))
}

async function loadDotenv() {
  try {
    const fs = await import('node:fs/promises')
    const text = await fs.readFile('.env', 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
      if (!match || process.env[match[1]] !== undefined) continue
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
    }
  } catch {
    // Production hosts usually inject env vars directly.
  }
}

main().catch(err => {
  console.error(err.stack || err.message)
  process.exit(1)
})

process.once('SIGTERM', () => shutdown('SIGTERM'))
process.once('SIGINT', () => shutdown('SIGINT'))
