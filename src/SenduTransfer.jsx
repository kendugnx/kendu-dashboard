import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createWalletClient, custom, parseAbi, parseUnits } from 'viem'
import styles from './SenduWalletLink.module.css'

const projectId = import.meta.env.VITE_REOWN_PROJECT_ID || ''
const ERC20_ABI = parseAbi(['function transfer(address to, uint256 amount) returns (bool)'])

export default function SenduTransfer({ action }) {
  const token = useMemo(() => new URLSearchParams(window.location.hash.slice(1)).get('token') || '', [])
  const [details, setDetails] = useState(null)
  const [amount, setAmount] = useState('')
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const walletRef = useRef(null)

  useEffect(() => {
    senduAction({ action, type: 'details', token })
      .then(data => { setDetails(data); setStatus('idle') })
      .catch(err => { setError(err.message); setStatus('error') })
  }, [action, token])

  async function submit() {
    setError('')
    const amountPattern = action === 'withdraw' ? /^\d+$/ : /^\d+(?:\.\d{1,18})?$/
    if (!amount || !amountPattern.test(amount)) {
      setError(action === 'withdraw' ? 'Enter a whole Kendu amount.' : 'Enter a valid Kendu amount.')
      return
    }
    try {
      const connected = walletRef.current || await connectWallet()
      if (!connected) return
      if (connected.address.toLowerCase() !== details.walletAddress.toLowerCase()) {
        throw new Error(`Connect the linked wallet ${details.walletAddress}`)
      }

      if (action === 'deposit') {
        setStatus('confirming')
        const txHash = await connected.client.writeContract({
          account: connected.address,
          address: details.tokenAddress,
          abi: ERC20_ABI,
          functionName: 'transfer',
          args: [details.communityAddress, parseUnits(amount, 18)],
        })
        setStatus('waiting')
        const credited = await waitForDeposit(txHash)
        setResult({ title: 'Deposit credited', detail: `${credited.amount} Kendu`, txHash })
      } else {
        setStatus('preparing')
        const challenge = await senduAction({ action, type: 'challenge', token, address: connected.address, amount })
        setStatus('signing')
        const signature = await connected.client.signMessage({ account: connected.address, message: challenge.message })
        setStatus('submitting')
        const queued = await senduAction({ action, type: 'complete', token, address: connected.address, signature })
        setResult({ title: 'Withdrawal queued', detail: `${queued.amount} Kendu`, requestId: queued.id })
      }
      setStatus('complete')
    } catch (requestError) {
      const rejected = requestError?.code === 4001 || /rejected|denied/i.test(requestError?.message || '')
      setError(rejected ? 'The wallet request was cancelled.' : requestError.message || 'Sendu request failed.')
      setStatus('idle')
    }
  }

  async function waitForDeposit(txHash) {
    for (let attempt = 0; attempt < 45; attempt += 1) {
      try {
        return await senduAction({ action: 'deposit', type: 'complete', token, txHash })
      } catch (requestError) {
        if (!/not found|not confirmed|required confirmations/i.test(requestError.message || '')) throw requestError
      }
      await new Promise(resolve => setTimeout(resolve, 4000))
    }
    throw new Error(`The transaction was sent but is still confirming. Use /sendu deposit claim ${txHash} in the private bot chat.`)
  }

  async function connectWallet() {
    let modal
    setStatus('connecting')
    const [{ default: UniversalProvider }, { WalletConnectModal }] = await Promise.all([
      import('@walletconnect/universal-provider'),
      import('@walletconnect/modal'),
    ])
    const provider = await UniversalProvider.init({
      projectId,
      metadata: {
        name: 'Kendu Dashboard',
        description: 'Kendu Sendu deposits and withdrawals',
        url: window.location.origin,
        icons: [`${window.location.origin}/kendu-mask.png`],
      },
    })
    modal = new WalletConnectModal({ projectId, chains: ['eip155:8453'], themeMode: 'dark' })
    provider.on('display_uri', uri => modal.openModal({ uri, chains: ['eip155:8453'] }))
    try {
      await provider.connect({
        namespaces: {
          eip155: {
            methods: ['personal_sign', 'eth_sendTransaction'],
            chains: ['eip155:8453'],
            events: ['accountsChanged', 'chainChanged'],
          },
        },
      })
      modal.closeModal()
      const client = createWalletClient({ transport: custom(provider) })
      const [address] = await client.requestAddresses()
      if (!address) throw new Error('No wallet account was selected')
      const connected = { client, address }
      walletRef.current = connected
      return connected
    } catch (requestError) {
      modal?.closeModal()
      throw requestError
    }
  }

  const isBusy = !['idle', 'error'].includes(status)
  const labels = {
    loading: 'Loading...',
    idle: action === 'deposit' ? 'Deposit Kendu' : 'Authorize Withdrawal',
    connecting: 'Choose a Wallet...',
    confirming: 'Confirm in Wallet...',
    waiting: 'Waiting for Base confirmations...',
    preparing: 'Preparing authorization...',
    signing: 'Confirm Signature...',
    submitting: 'Queuing Withdrawal...',
  }

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
          <div className={styles.eyebrow}>KENDU SENDU</div>
          {status === 'complete' ? (
            <>
              <h1>{result.title}</h1>
              <p>{result.detail}</p>
              {result.requestId && <div className={styles.address}>{result.requestId}</div>}
              {result.txHash && <a className={styles.primaryLink} href={`https://basescan.org/tx/${result.txHash}`}>View transaction</a>}
            </>
          ) : (
            <>
              <h1>{action === 'deposit' ? 'Deposit Kendu' : 'Withdraw Kendu'}</h1>
              <p>{action === 'deposit'
                ? 'Send Base Kendu from your linked wallet to your Sendu balance.'
                : 'Sign a free authorization to withdraw Kendu to your linked wallet.'}</p>
              {details?.walletAddress && <div className={styles.address}>{details.walletAddress}</div>}
              <label className={styles.fieldLabel} htmlFor="sendu-amount">Kendu amount</label>
              <input id="sendu-amount" className={styles.amountInput} inputMode={action === 'withdraw' ? 'numeric' : 'decimal'} value={amount} onChange={event => setAmount(event.target.value)} placeholder="1000" disabled={isBusy} />
              {error && <div className={styles.error} role="alert">{error}</div>}
              <button className={styles.primaryButton} type="button" onClick={submit} disabled={isBusy || !details || !projectId}>
                {labels[status] || 'Processing...'}
              </button>
              <div className={styles.securityNote}>Single-use link · Base network · Linked wallet required</div>
            </>
          )}
        </section>
      </main>
    </div>
  )
}

async function senduAction(body) {
  const response = await fetch('/api/telegram?sendu=action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(json.error || 'Sendu request failed')
  return json
}
