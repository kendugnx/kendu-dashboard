import React, { useMemo, useState } from 'react'
import { createWalletClient, custom } from 'viem'
import styles from './SenduWalletLink.module.css'

export default function SenduWalletLink() {
  const token = useMemo(() => new URLSearchParams(window.location.hash.slice(1)).get('token') || '', [])
  const [status, setStatus] = useState('idle')
  const [address, setAddress] = useState('')
  const [error, setError] = useState('')

  async function linkWallet() {
    setError('')
    if (!token) {
      setError('This wallet-link request is missing or expired. Request a new link from the bot.')
      return
    }
    if (!window.ethereum) {
      setError('MetaMask was not detected. Open this page in a browser with MetaMask installed.')
      return
    }

    try {
      setStatus('connecting')
      const walletClient = createWalletClient({ transport: custom(window.ethereum) })
      const [account] = await walletClient.requestAddresses()
      if (!account) throw new Error('No wallet account was selected')
      setAddress(account)

      setStatus('preparing')
      const challenge = await senduRequest({ action: 'challenge', token, address: account })

      setStatus('signing')
      const signature = await walletClient.signMessage({ account, message: challenge.message })

      setStatus('verifying')
      const linked = await senduRequest({ action: 'verify', token, address: account, signature })
      setAddress(linked.address)
      setStatus('complete')
    } catch (requestError) {
      const rejected = requestError?.code === 4001 || /rejected|denied/i.test(requestError?.message || '')
      setError(rejected ? 'The signature request was cancelled. Your wallet was not linked.' : requestError.message || 'Wallet linking failed.')
      setStatus('idle')
    }
  }

  const buttonLabel = {
    idle: 'Connect MetaMask',
    connecting: 'Connecting...',
    preparing: 'Preparing signature...',
    signing: 'Confirm in MetaMask...',
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
              <div className={styles.address}>{address}</div>
              <a className={styles.primaryLink} href="/">Return to dashboard</a>
            </>
          ) : (
            <>
              <h1>Link your wallet</h1>
              <p>Connect MetaMask and sign a free ownership message. This does not approve tokens, send a transaction, or expose your private key.</p>
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
  const response = await fetch('/api/sendu', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(json.error || 'Sendu request failed')
  return json
}
