# KENDU Dashboard

Live dashboard for KENDU holders — market cap, holders, treasury, and more.

---

## First-time setup

### 1. Install Node.js
Download from https://nodejs.org and install the LTS version.
Verify it worked by opening Terminal and running:
```
node --version
```
You should see something like `v20.x.x`.

---

### 2. Get the project onto your Mac

If you received this as a zip file:
- Unzip it somewhere you can find it (Desktop is fine)
- Open Terminal
- Type `cd ` (with a space after), then drag the folder into the Terminal window and press Enter

---

### 3. Install dependencies
```
npm install
```
This downloads React, Vite, and everything else the project needs. Takes about 30 seconds.

---

### 4. Set up your environment variables
```
cp .env.example .env.local
```
This creates a local copy of the environment config. The defaults work out of the box for local development.

---

### 5. Run it locally
```
npm run dev
```
Open your browser to http://localhost:5173 — you should see the dashboard.

> **Note:** The API proxy routes (`/api/*`) only work when deployed to Vercel. Locally, the app falls back to direct API calls where possible. Some features like treasury data may not load locally — that's expected.

---

## Deploy to Vercel

### First deploy
1. Push this folder to a GitHub repository
2. Go to https://vercel.com and click "Add New Project"
3. Import your GitHub repo
4. Vercel auto-detects Vite — no config needed
5. Click Deploy

### Set environment variables in Vercel
1. Go to your project in the Vercel dashboard
2. Settings > Environment Variables
3. Add: `ETHERSCAN_API_KEY` = your Etherscan key

### Connect your domain
1. In Vercel: Settings > Domains
2. Add `kendu-dashboard.com`
3. Vercel gives you DNS records to add at your domain registrar
4. Once DNS propagates (up to 24h, usually faster), your site is live

---

## Project structure

```
kendu-dashboard/
  api/                    Vercel serverless functions (backend proxy)
    dexscreener.js        Proxies Dexscreener API
    etherscan.js          Proxies Etherscan gas API (key stored server-side)
    treasury.js           Fetches treasury + LP values server-side
  src/
    components/           One file per widget
      NetworkPulse        ETH price, gas, Fear & Greed, Alt Season
      HoldersChart        Total holders over time with filters
      HolderMilestone     Ring progress toward next holder goal
      HolderComposition   ETH/SOL/BASE breakdown donut
      TreasuryLP          Treasury wallet + LP pool values
      Calculator          MC calculator with holder tiers
    hooks/
      useRefresh.js       Shared refresh button + spin logic
      useChartCanvas.js   DPR-aware canvas sizing
    utils/
      index.js            Fetch helpers, formatters, CSV parser
      constants.js        All addresses, URLs, tier definitions
      chart.js            Canvas drawing utilities
    App.jsx               Dashboard layout
    index.css             Global CSS tokens (single source of truth)
  .env.example            Environment variable template
  vercel.json             Vercel routing config
```

---

## Adding a new widget

1. Create `src/components/YourWidget.jsx` and `YourWidget.module.css`
2. Import and add it to `App.jsx`
3. If it needs a keyed API, add a route in `api/`
4. If it needs an env var, add it to `.env.example` and Vercel dashboard

That's it.
