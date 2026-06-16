// ============================================================
// Data constants -- URLs, addresses, keys
// ============================================================

export const HOLDERS_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTD6EM3vr9AZzq8WDqFpxLEQOxqEBc-w89053lNBDed4AUcxKfeVl1lSPiK9bUJFkPN1Y3X-tVXrGnG/pub?gid=584295169&single=true&output=csv'
export const MC_CSV_URL      = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSCFruPPrQ9BVDvjimW3Ev27DN6SejGZ2KWLRRgtX_PnOIi0r0baF3zt-GcibRXbw7pHMhgHbJ-J1HH/pub?gid=81224958&single=true&output=csv'

export const TREASURY_WALLET = '0xD22849fcB4C83389E65a1c40748a9b67157638A3'
export const TREASURY_ETHERSCAN_URL = `https://etherscan.io/address/${TREASURY_WALLET}`

export const LPS = {
  eth:  { address: '0xD9f2A7471d1998C69De5Cae6dF5d3f070F01DF9F', link: 'https://dexscreener.com/ethereum/0xd9f2a7471d1998c69de5cae6df5d3f070f01df9f',  label: 'ETH: Uniswap V2' },
  base: { address: '0xFBFD0e1838A101a26FDB5D4ae0B4D17153eCA66B', link: 'https://dexscreener.com/base/0xfbfd0e1838a101a26fdb5d4ae0b4d17153eca66b',    label: 'BASE: Aerodrome' },
  sol:  { address: 'B34Pu6w8eecYRXLEDxBCPy5JoFLy3iycLAPJpYiwbKMK', link: 'https://dexscreener.com/solana/b34pu6w8eecyrxledxbcpy5jofly3iyclapjpyiwbkmk', label: 'SOL: Raydium' },
}

// Contract / exchange wallets excluded from holder-concentration (HHI) calculations —
// these aren't individually-controlled positions, they're bridges, LPs, and CEX hot wallets.
export const HHI_EXCLUDED_ADDRESSES = [
  '0x3ee18B2214AFF97000D974cf647E7C347E8fa585', // Wormhole bridge
  '0xD9f2A7471d1998C69De5Cae6dF5d3f070F01DF9F', // Uniswap V2
  '0x1474c1fA8078EDeeEb9753d76526c142158f3236', // Uniswap V3
  '0x60a84e22d9d2b7FAbAcc3fdc987688B891acBF49', // Uniswap V3 / USDC
  '0x22f83e4b9cB95CB99B88E8f4f15ea598C74c2788', // LBank
  '0x6D0D19bddDC5ED1dD501430c9621DD37ebd9062d', // BitMart
].map(a => a.toLowerCase())

export const KENDU_ETH_CA  = '0xaa95f26e30001251fb905d264Aa7b00eE9dF6C18'
export const CIRC_SUPPLY   = 996.74e9
export const ETHERSCAN_KEY = 'M5XZ6NDDYYQ5HY9KVUQDJ12ME484DVEP4A'
export const DEX_TOKEN_URL = `https://api.dexscreener.com/latest/dex/tokens/${KENDU_ETH_CA}`

// Holder tier definitions
export const TIER_DEFS = [
  { name: 'Seaweed',       min: 0,      max: 1e6   },
  { name: 'Plankton',      min: 1e6,    max: 5e6   },
  { name: 'Shrimp',        min: 5e6,    max: 10e6  },
  { name: 'Magikarp',      min: 10e6,   max: 20e6  },
  { name: 'Crab',          min: 20e6,   max: 35e6  },
  { name: 'Sardine',       min: 35e6,   max: 50e6  },
  { name: 'Stingray',      min: 50e6,   max: 75e6  },
  { name: 'Octopus',       min: 75e6,   max: 100e6 },
  { name: 'Dolphin',       min: 100e6,  max: 150e6 },
  { name: 'Barracuda',     min: 150e6,  max: 200e6 },
  { name: 'Shark',         min: 200e6,  max: 300e6 },
  { name: 'Orca',          min: 300e6,  max: 400e6 },
  { name: 'Swordfish',     min: 400e6,  max: 500e6 },
  { name: 'Whale',         min: 500e6,  max: 700e6 },
  { name: 'Leviathan',     min: 700e6,  max: 900e6 },
  { name: 'Kraken',        min: 900e6,  max: 1.2e9 },
  { name: 'Chadasaurus',   min: 1.2e9,  max: 1.6e9 },
  { name: 'Megalodon',     min: 1.6e9,  max: 2.3e9 },
  { name: 'Gyrados',       min: 2.3e9,  max: 3.5e9 },
  { name: 'Godwhale',      min: 3.5e9,  max: 4.5e9 },
  { name: 'Kendu Eternal', min: 4.5e9,  max: Infinity },
]

export function tierForMC(mc) {
  if (!isFinite(mc)) return null
  return TIER_DEFS.findIndex(t => mc >= t.min && mc < t.max)
}

// Tiers based on token count (matching original calculator behavior)
export function tierForTokens(tok) {
  if (!isFinite(tok) || tok <= 0) return -1
  const idx = TIER_DEFS.findIndex(t => tok >= t.min && tok < t.max)
  return idx >= 0 ? idx : TIER_DEFS.length - 1
}
