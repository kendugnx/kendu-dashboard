# Kendu Buy Bot Worker

This is a separate long-running worker that uses the existing Kendu Dashboard Telegram bot token.

## Local Testing

Dry-run against live trade APIs without posting to Telegram:

```bash
npm run buybot:dry-run
```

Run one pass and post new alerts if Telegram env vars are configured:

```bash
npm run buybot:once
```

Run continuously:

```bash
npm run buybot:watch
```

Watch mode primes silently when no state file exists. It does not post historical sample buys on startup, after a missing state file, or when its last saved marker falls out of the recent-trades window. It still posts live buys after each chain has a saved marker.

## Environment Variables

Required to post alerts:

```text
TELEGRAM_BOT_TOKEN=...
BUY_BOT_CHAT_ID=...
```

Optional:

```text
BUY_BOT_DRY_RUN=1
BUY_BOT_CHAINS=eth,base,sol
BUY_BOT_MIN_USD=25
BUY_BOT_ETH_MIN_USD=25
BUY_BOT_BASE_MIN_USD=10
BUY_BOT_SOL_MIN_USD=10
BUY_BOT_POLL_MS=60000
BUY_BOT_CHAIN_DELAY_MS=3000
BUY_BOT_STATE_FILE=/data/.buy-bot-state.json
BUY_BOT_ETH_RPC_URL=https://ethereum-rpc.publicnode.com
BUY_BOT_BASE_RPC_URL=https://mainnet.base.org
BUY_BOT_SOL_RPC_URL=https://api.mainnet-beta.solana.com
BUY_BOT_MEDIA_URL=https://kendu-dashboard.com/kendu-surprise.mp4
BUY_BOT_ETH_MEDIA_URL=https://kendu-dashboard.com/BUY_ETH.mp4
BUY_BOT_BASE_MEDIA_URL=https://kendu-dashboard.com/BUY_BASE.mp4
BUY_BOT_SOL_MEDIA_URL=https://kendu-dashboard.com/BUY_SOL.mp4
BUY_BOT_EMOJI=🪙
BUY_BOT_CUSTOM_EMOJI_ID=...
BUY_BOT_EMOJI_USD=50
```

`BUY_BOT_CUSTOM_EMOJI_ID` is optional. Set it to the Telegram custom emoji ID for the spinning Kendu coin to use that animated emoji as the buy indicator. If it is blank, the bot uses `BUY_BOT_EMOJI`.

If the chain-specific media variables are not set, the worker defaults to:

```text
https://kendu-dashboard.com/BUY_ETH.mp4
https://kendu-dashboard.com/BUY_BASE.mp4
https://kendu-dashboard.com/BUY_SOL.mp4
```

## Hosting Notes

Do not run this inside Vercel serverless functions. It should run as an always-on worker on a host such as Railway, Render, Fly.io, or a small VPS.

The worker stores its last-seen trade IDs in `BUY_BOT_STATE_FILE`. On Railway, attach a persistent volume mounted at `/data` and keep `BUY_BOT_STATE_FILE=/data/.buy-bot-state.json` so restarts do not repost recent buys. The worker creates the folder automatically if it does not exist, but without a volume the file may be lost on redeploys.

## Current Data Source

The worker polls GeckoTerminal recent trades for ETH, Base, and Solana pools and uses DexScreener for the current KENDU market cap.

If GeckoTerminal rate-limits one chain, that chain logs an error and the worker keeps processing the others.
