import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/proxy/coingecko': {
        target: 'https://api.coingecko.com',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/proxy\/coingecko/, '/api/v3'),
      },
      '/proxy/etherscan': {
        target: 'https://api.etherscan.io',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/proxy\/etherscan/, '/v2/api'),
      },
      '/proxy/ethrpc': {
        target: 'https://rpc.ankr.com',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/proxy\/ethrpc$/, '/eth'),
      },
      '/proxy/ethrpc2': {
        target: 'https://cloudflare-eth.com',
        changeOrigin: true,
        rewrite: () => '/',
      },
      '/proxy/ethrpc3': {
        target: 'https://ethereum.publicnode.com',
        changeOrigin: true,
        rewrite: () => '/',
      },
      '/proxy/dexscreener': {
        target: 'https://api.dexscreener.com',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/proxy\/dexscreener/, ''),
      },
      '/proxy/ethplorer': {
        target: 'https://api.ethplorer.io',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/proxy\/ethplorer/, ''),
      },
      '/proxy/cmc': {
        target: 'https://api.coinmarketcap.com',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/proxy\/cmc/, ''),
      },
      '/proxy/blockchaincenter': {
        target: 'https://www.blockchaincenter.net',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/proxy\/blockchaincenter/, ''),
      },
      '/proxy/fng': {
        target: 'https://api.alternative.me',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/proxy\/fng/, ''),
      },
    },
  },
})
