# Sendu tipping sandbox

The first Sendu milestone is an isolated, simulated ledger. It does not accept deposits, hold wallet keys, or send withdrawals.

## Safety boundaries

- The module is disabled unless `TIPPING_ENABLED=true`.
- It only responds inside chat IDs listed in `TIPPING_TEST_CHAT_IDS`.
- Sandbox funding is limited to Telegram IDs in `TIPPING_ADMIN_USER_IDS`.
- Tipping tables use the `sendu_` prefix and do not share state with reminders or the buy bot.
- Tips use immutable Telegram user IDs. Usernames are display and lookup aliases only.
- Every balance-changing Telegram command is deduplicated by chat and message ID.
- Pending tips expire back to the sender after 30 days by default.
- Every user must affirmatively accept the current Sendu terms before using personal balance, tip, claim, or funding commands.
- Terms acceptance is versioned and recorded against the immutable Telegram user ID.

## Environment variables

Set these in Vercel for the Telegram webhook deployment:

```text
TIPPING_ENABLED=true
TIPPING_TEST_CHAT_IDS=<test-chat-id>
TIPPING_ADMIN_USER_IDS=7414795595
TIPPING_DATABASE_URL=postgresql://...
TIPPING_CLAIM_DAYS=30
TIPPING_MAX_TIP=1000000000
```

`TIPPING_TEST_CHAT_IDS` and `TIPPING_ADMIN_USER_IDS` accept comma-separated values. If the test-chat list is empty, the feature is inaccessible even when enabled.

Use a PostgreSQL connection string for `TIPPING_DATABASE_URL`. The module creates its isolated tables on first use.

## Sandbox commands

The commands intentionally remain hidden from the public Telegram command menu.

```text
/sendu help
/sendu balance
/sendu history
/sendu ledger
/sendu ledger 2
/sendu claim
/sendu terms
/sendu link
/sendu wallet
/sendu @username 1000
```

Reply-based tipping is preferred because it identifies the recipient by immutable Telegram ID:

```text
Reply to a user's message with: /sendu 1000
```

An administrator can add simulated funds:

```text
/sendu fund 1000000
/sendu fund @username 1000000
```

No value in this sandbox represents real Kendu. Deposits and withdrawals belong to later milestones.

## Wallet linking

Terms acceptance and wallet linking happen in a private chat with the bot. `/sendu link` creates a hashed, single-use dashboard token that expires after 15 minutes. The dashboard requests an EIP-191 ownership signature from MetaMask. It never requests a transaction or token approval, and the server stores only the verified public address.
