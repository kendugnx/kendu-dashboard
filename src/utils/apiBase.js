// Detect whether we're running locally (Vite dev server) or on Vercel.
// On Vercel, /api/* routes are serverless functions.
// Locally, we use Vite's dev proxy to bypass CORS.

const IS_DEV = import.meta.env.DEV

export const API = {
  // Vercel serverless proxy endpoints
  etherscan:   (params) => IS_DEV
    ? `/proxy/etherscan?chainid=1&${params}&apikey=M5XZ6NDDYYQ5HY9KVUQDJ12ME484DVEP4A`
    : `/api/etherscan?${params}`,
  dexscreener: (params) => `/api/dexscreener?${params}`,
  treasury:    ()       => `/api/treasury`,

  // Direct external URLs -- routed through Vite proxy locally, direct on Vercel server
  coingecko:  (path) => IS_DEV ? `/proxy/coingecko${path}` : `/api/coingecko${path}`,
  ethplorer:  (path) => IS_DEV ? `/proxy/ethplorer${path}` : `https://api.ethplorer.io${path}`,
  fng:        (path) => IS_DEV ? `/proxy/fng${path}`       : `https://api.alternative.me${path}`,
  ethrpc:     ()     => IS_DEV ? `/proxy/ethrpc`           : `https://rpc.ankr.com/eth`,
  dex:        (path) => IS_DEV ? `/proxy/dexscreener${path}` : `https://api.dexscreener.com${path}`,
  cmc:        (path) => IS_DEV ? `/proxy/cmc${path}` : `/api/cmc?path=${encodeURIComponent(path)}`,
}
