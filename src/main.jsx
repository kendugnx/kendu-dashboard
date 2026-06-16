import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import SnapshotEmbed from './SnapshotEmbed.jsx'

if (window.Telegram?.WebApp) {
  window.Telegram.WebApp.expand()
  window.Telegram.WebApp.ready()
}

const isSnapshotEmbed = window.location.pathname === '/embed/snapshot'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isSnapshotEmbed ? <SnapshotEmbed /> : <App />}
  </React.StrictMode>
)
