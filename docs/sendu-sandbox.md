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

## Environment variables

Set these in Vercel for the Telegram webhook deployment:

```text
TIPPING_ENABLED=true
TIPPING_TEST_CHAT_IDS=-5129334741
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
/sendu claim
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

No value in this sandbox represents real Kendu. Deposits, wallet linking, and withdrawals belong to later milestones.
