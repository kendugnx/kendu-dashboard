import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createWalletClient, custom, parseAbi } from 'viem'
import { base } from 'viem/chains'
import styles from './SenduWalletLink.module.css'

const projectId = import.meta.env.VITE_REOWN_PROJECT_ID || ''
const ERC20_ABI = parseAbi(['function transfer(address to, uint256 amount) returns (bool)'])

export default function SenduDirect() {
  const token = useMemo(() => new URLSearchParams(window.location.hash.slice(1)).get('token') || '', [])
  const [details, setDetails] = useState(null)
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')
  const [txHash, setTxHash] = useState('')
  const walletRef = useRef(null)

  useEffect(() => {
    directRequest({ type: 'details', token })
      .then(data => { setDetails(data); setStatus('idle') })
      .catch(requestError => { setError(requestError.message); setStatus('error') })
  }, [token])

  async function submit() {
    setError('')
    try {
      const connected = walletRef.current || await connectWallet()
      if (connected.address.toLowerCase() !== details.senderAddress.toLowerCase()) {
        throw new Error(`Connect the linked sender wallet ${details.senderAddress}`)
      }
      setStatus('confirming')
      const hash = await connected.client.writeContract({
        account: connected.address,
        address: details.tokenAddress,
        abi: ERC20_ABI,
        functionName: 'transfer',
        args: [details.recipientAddress, BigInt(details.amountRaw)],
        chain: base,
      })
      setTxHash(hash)
      setStatus('waiting')
      await waitForVerification(hash)
      setStatus('complete')
    } catch (requestError) {
      const rejected = requestError?.code === 4001 || /rejected|denied/i.test(requestError?.message || '')
      setError(rejected ? 'The wallet request was cancelled.' : requestError.message || 'Kendu Sendu failed.')
      setStatus('idle')
    }
  }

  async function waitForVerification(hash) {
    for (let attempt = 0; attempt < 45; attempt += 1) {
      try { return await directRequest({ type: 'complete', token, txHash: hash }) } catch (requestError) {
        if (!/not found|not confirmed|required confirmations|announcement is still pending/i.test(requestError.message || '')) throw requestError
      }
      await new Promise(resolve => setTimeout(resolve, 4000))
    }
    throw new Error(`The transaction was sent but is still confirming. Verify it in Telegram with /sendu verify ${details.id} ${hash}`)
  }

  async function connectWallet() {
    setStatus('connecting')
    const [{ default: UniversalProvider }, { WalletConnectModal }] = await Promise.all([
      import('@walletconnect/universal-provider'), import('@walletconnect/modal'),
    ])
    const provider = await UniversalProvider.init({
      projectId,
      metadata: { name: 'Kendu Dashboard', description: 'Kendu Sendu', url: window.location.origin, icons: [`${window.location.origin}/kendu-mask.png`] },
    })
    const modal = new WalletConnectModal({ projectId, chains: ['eip155:8453'], themeMode: 'dark' })
    provider.on('display_uri', uri => modal.openModal({ uri, chains: ['eip155:8453'] }))
    try {
      await provider.connect({ namespaces: { eip155: {
        methods: ['eth_sendTransaction'], chains: ['eip155:8453'], events: ['accountsChanged', 'chainChanged'],
      } } })
      modal.closeModal()
      const client = createWalletClient({ chain: base, transport: custom(provider) })
      const [address] = await client.requestAddresses()
      if (!address) throw new Error('No wallet account was selected')
      walletRef.current = { client, address }
      return walletRef.current
    } catch (requestError) {
      modal.closeModal()
      throw requestError
    }
  }

  const labels = {
    loading: 'Loading...', idle: 'Send Kendu', connecting: 'Choose a Wallet...',
    confirming: 'Confirm in Wallet...', waiting: 'Verifying Base Transaction...',
  }
  const busy = !['idle', 'error'].includes(status)
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <a className={styles.brand} href="/" aria-label="Kendu Dashboard"><img src="/kendu-mask.png" alt="" /><span><strong>KENDU</strong> DASHBOARD</span></a>
      </header>
      <main className={styles.main}>
        <section className={styles.panel}>
          <div className={styles.eyebrow}>KENDU SENDU</div>
          {status === 'complete' ? <>
            <h1>Sendu complete</h1><p>{details.amount} Kendu was sent directly to {details.recipient}.</p>
            <a className={styles.primaryLink} href={`https://basescan.org/tx/${txHash}`}>View transaction</a>
          </> : <>
            <h1>Send {details?.amount || ''} Kendu</h1>
            <p>{details ? `${details.sender} → ${details.recipient}` : 'Loading transfer details...'}</p>
            {details && <div className={styles.address}>{details.recipientAddress}</div>}
            {error && <div className={styles.error} role="alert">{error}</div>}
            <button className={styles.primaryButton} type="button" onClick={submit} disabled={busy || !details || !projectId}>{labels[status] || 'Processing...'}</button>
            <div className={styles.securityNote}>Direct wallet transfer · Base network · Review in your wallet</div>
          </>}
        </section>
      </main>
    </div>
  )
}

async function directRequest(body) {
  const response = await fetch('/api/telegram?sendu=direct', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const json = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(json.error || 'Kendu Sendu failed')
  return json
}
