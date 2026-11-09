import { createWalletClient, custom } from 'viem'
import { base } from 'viem/chains'

export async function connectInjectedWallet() {
  const provider = findInjectedProvider()
  if (!provider?.request) return null

  await provider.request({ method: 'eth_requestAccounts' })
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x2105' }] })
  } catch (error) {
    if (error?.code !== 4902 && !/unrecognized|not added|unknown chain/i.test(error?.message || '')) throw error
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: '0x2105',
        chainName: 'Base',
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: ['https://mainnet.base.org'],
        blockExplorerUrls: ['https://basescan.org'],
      }],
    })
  }

  const client = createWalletClient({ chain: base, transport: custom(provider) })
  const [address] = await client.requestAddresses()
  if (!address) throw new Error('No wallet account was selected')
  return { client, address }
}

function findInjectedProvider() {
  const providers = window.ethereum?.providers
  if (Array.isArray(providers) && providers.length) return providers[0]
  return window.ethereum || window.trustwallet?.ethereum || null
}
