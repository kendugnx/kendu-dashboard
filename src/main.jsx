import React, { lazy, Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import SnapshotEmbed from './SnapshotEmbed.jsx'

const SenduWalletLink = lazy(() => import('./SenduWalletLink.jsx'))

if (window.Telegram?.WebApp) {
  window.Telegram.WebApp.expand()
  window.Telegram.WebApp.ready()
}

const isSnapshotEmbed = window.location.pathname === '/embed/snapshot'
const isSenduWalletLink = window.location.pathname === '/sendu/link'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isSnapshotEmbed ? <SnapshotEmbed /> : isSenduWalletLink ? (
      <Suspense fallback={null}><SenduWalletLink /></Suspense>
    ) : <App />}
  </React.StrictMode>
)
