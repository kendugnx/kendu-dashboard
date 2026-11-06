import React, { useMemo, useRef, useState } from 'react'
import { createWalletClient, custom } from 'viem'
import styles from './SenduWalletLink.module.css'

const projectId = import.meta.env.VITE_REOWN_PROJECT_ID || ''

export default function SenduWalletLink() {
  const token = useMemo(() => new URLSearchParams(window.location.hash.slice(1)).get('token') || '', [])
  const [status, setStatus] = useState('idle')
  const [address, setAddress] = useState('')
  const [linkedAddress, setLinkedAddress] = useState('')
  const [error, setError] = useState('')
  const walletClientRef = useRef(null)

  async function linkWallet() {
    setError('')
    if (!token) {
      setError('This wallet-link request is missing or expired. Request a new link from the bot.')
      return
    }
    if (!projectId) {
      setError('Wallet connections are temporarily unavailable. Please try again shortly.')
      return
    }

    if (!walletClientRef.current || !address) {
      await connectWallet()
      return
    }

    try {
      setStatus('preparing')
      const challenge = await senduRequest({ action: 'challenge', token, address })

      setStatus('signing')
      const signature = await walletClientRef.current.signMessage({ account: address, message: challenge.message })

      setStatus('verifying')
      const linked = await senduRequest({ action: 'verify', token, address, signature })
      setLinkedAddress(linked.address)
      setStatus('complete')
    } catch (requestError) {
      const rejected = requestError?.code === 4001 || /rejected|denied/i.test(requestError?.message || '')
      setError(rejected ? 'The signature request was cancelled. Your wallet was not linked.' : requestError.message || 'Wallet linking failed.')
      setStatus('idle')
    }
  }

  async function connectWallet() {
    try {
      setStatus('connecting')
      const [{ default: UniversalProvider }, { WalletConnectModal }] = await Promise.all([
        import('@walletconnect/universal-provider'),
        import('@walletconnect/modal'),
      ])
      const provider = await UniversalProvider.init({
        projectId,
        metadata: {
          name: 'Kendu Dashboard',
          description: 'Kendu community dashboard and Sendu wallet linking',
          url: window.location.origin,
          icons: [`${window.location.origin}/kendu-mask.png`],
        },
      })
      const modal = new WalletConnectModal({ projectId, chains: ['eip155:8453'], themeMode: 'dark' })
      provider.on('display_uri', (uri) => modal.openModal({ uri, chains: ['eip155:8453'] }))
      await provider.connect({
        namespaces: {
          eip155: {
            methods: ['personal_sign'],
            chains: ['eip155:8453'],
            events: ['accountsChanged', 'chainChanged'],
          },
        },
      })
      modal.closeModal()

      const walletClient = createWalletClient({ transport: custom(provider) })
      const [account] = await walletClient.requestAddresses()
      if (!account) throw new Error('No wallet account was selected')
      walletClientRef.current = walletClient
      setAddress(account)
      setStatus('idle')
    } catch (requestError) {
      const rejected = /rejected|denied|cancelled|closed/i.test(requestError?.message || '')
      setError(rejected ? 'The wallet connection was cancelled.' : requestError.message || 'Wallet connection failed.')
      setStatus('idle')
    }
  }

  const buttonLabel = {
    idle: address ? 'Verify Wallet' : 'Connect Wallet',
    connecting: 'Choose a Wallet...',
    preparing: 'Preparing signature...',
    signing: 'Confirm in Wallet...',
    verifying: 'Verifying...',
  }[status]

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <a className={styles.brand} href="/" aria-label="Kendu Dashboard">
          <img src="/kendu-mask.png" alt="" />
          <span><strong>KENDU</strong> DASHBOARD</span>
        </a>
      </header>

      <main className={styles.main}>
        <section className={styles.panel}>
          <div className={styles.eyebrow}>SENDU WALLET</div>
          {status === 'complete' ? (
            <>
              <h1>Wallet linked</h1>
              <p>Your wallet ownership was verified and connected to your Telegram Sendu account.</p>
              <div className={styles.address}>{linkedAddress}</div>
              <a className={styles.primaryLink} href="/">Return to dashboard</a>
            </>
          ) : (
            <>
              <h1>Link your wallet</h1>
              <p>Connect your wallet and sign a free ownership message. This does not approve tokens, send a transaction, or expose your private key.</p>
              {address && <div className={styles.address}>{address}</div>}
              {error && <div className={styles.error} role="alert">{error}</div>}
              <button className={styles.primaryButton} type="button" onClick={linkWallet} disabled={status !== 'idle'}>
                {buttonLabel}
              </button>
              <div className={styles.securityNote}>Single-use link · Expires after 15 minutes · Base wallet</div>
            </>
          )}
        </section>
      </main>
    </div>
  )
}

async function senduRequest(body) {
  const response = await fetch('/api/telegram?sendu=wallet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(json.error || 'Sendu request failed')
  return json
}
