import React, { lazy, Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import SnapshotEmbed from './SnapshotEmbed.jsx'

const SenduWalletLink = lazy(() => import('./SenduWalletLink.jsx'))
const SenduTransfer = lazy(() => import('./SenduTransfer.jsx'))
const SenduDirect = lazy(() => import('./SenduDirect.jsx'))

if (window.Telegram?.WebApp) {
  window.Telegram.WebApp.expand()
  window.Telegram.WebApp.ready()
}

const isSnapshotEmbed = window.location.pathname === '/embed/snapshot'
const isSenduWalletLink = window.location.pathname === '/sendu/link'
const isSenduDirect = window.location.pathname === '/sendu/direct'
const senduTransferAction = window.location.pathname === '/sendu/deposit'
  ? 'deposit'
  : window.location.pathname === '/sendu/withdraw' ? 'withdraw' : null

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isSnapshotEmbed ? <SnapshotEmbed /> : isSenduDirect ? (
      <Suspense fallback={null}><SenduDirect /></Suspense>
    ) : senduTransferAction ? (
      <Suspense fallback={null}><SenduTransfer action={senduTransferAction} /></Suspense>
    ) : isSenduWalletLink ? (
      <Suspense fallback={null}><SenduWalletLink /></Suspense>
    ) : <App />}
  </React.StrictMode>
)
