# Poker Platform — Setup Guide

White-label multiplayer poker platform. Server-authoritative Texas Hold'em,
player accounts, admin panel, payment framework, licensed sweepstakes mode.
Deploy in under an hour.

## What you get

- **Poker server** — Node.js + Socket.IO, server-authoritative (no cheating), 8-player + 5-player tables
- **Player accounts** — register/login, server-side balances, transaction history (SQLite)
- **Admin panel** — live tables, players, ban/unban, coin adjustments, collusion flags, license activation (`/admin`)
- **White-label config** — one file to rebrand everything (`config/casino.json`)
- **Payment framework** — Stripe + crypto plug-in points (bring your own keys)
- **Sweepstakes mode** — encrypted, license-gated dual currency (unlocked after compliance proof)
- **Security** — CSPRNG shuffling, 2FA (TOTP), anti-collusion IP tracking, TLS/HSTS, security page (`/security`)

## Quick start (local)

```bash
cd server
npm install
node seed.js admin your-secure-password   # create admin account
node server.js                             # runs on :3000
```

Open:
- `http://localhost:3000/api/health` — server status
- `http://localhost:3000/admin` — admin panel (log in as admin)

## Deploy (Render, ~10 min)

1. Push this folder to a GitHub repo.
2. Render → New → Web Service → connect repo.
3. Build: `cd server && npm install` · Start: `cd server && node server.js`
4. Set env var `SESSION_SECRET` to a random string.
5. After first deploy, SSH/run once: `node server/seed.js admin <password>`.

## White-labeling

Edit `config/casino.json`:

| Section | What it controls |
|---|---|
| `casino` | Name, logo, tagline, support email |
| `theme` | Primary color, accent, available felts |
| `coins` | Currency name, signup bonus, coin packages + prices |
| `tables` | Table IDs, names, felt colors, blinds, max players |
| `payments` | Provider (`stripe`), API keys |

No code changes needed to rebrand.

## Client (tables UI)

Drop your built table UI into `client/` — the server serves it statically.
The client talks to the server via Socket.IO:

```js
socket.emit('join', { v: 1, table: 'emerald', session: '<auth token>', name: 'Player' });
```

Get the auth token from `POST /api/auth/login` or `/api/auth/register`.

## API reference

**Public** (`/api`)
- `GET /api/config` — casino branding, tables, coin packages
- `POST /api/auth/register` `{username, password, displayName}` → `{token, player}`
- `POST /api/auth/login` `{username, password}` → `{token, player}`
- `GET /api/me` — profile (auth)
- `GET /api/me/transactions` — history (auth)
- `POST /api/me/avatar` `{avatar}` — set avatar (auth)
- `GET /api/payments/providers` — configured providers
- `POST /api/payments/checkout` `{packageId, provider}` — start purchase (auth)
- `POST /api/payments/webhook` — provider callback (credits coins)

**Admin** (`/api/admin`, requires admin login)
- `GET /api/admin/stats` — player/table counts
- `GET /api/admin/tables` — live table status
- `GET /api/admin/players?limit&offset` — player list
- `GET /api/admin/players/:id` — player + transactions
- `POST /api/admin/players/:id/ban` `{banned}` — ban/unban
- `POST /api/admin/players/:id/adjust` `{amount, note}` — add/remove coins
- `GET /api/admin/license/status` — license + sweepstakes unlock state
- `POST /api/admin/license/activate` `{key}` — activate license key
- `GET /api/admin/license/audit` — license audit log
- `GET /api/admin/collusion/flags?reviewed=` — anti-collusion flags
- `POST /api/admin/collusion/flags/:id/review` — mark flag reviewed
- `GET /api/admin/collusion/analyze?table=` — heuristic analysis (stub v0)
- `GET /api/admin/sweep/redemptions?status=` — redemption queue (sweepstakes license only)
- `POST /api/admin/sweep/redemptions/:id/approve|deny` — decide redemptions

**Player 2FA** (`/api`, requires login)
- `POST /api/2fa/setup` → `{secret, otpauthUrl}` — start enrollment
- `POST /api/2fa/confirm` `{token}` — verify code, enable 2FA
- `POST /api/2fa/disable` `{password}` — disable 2FA
- Login accepts optional `totp` field; required when 2FA is enabled.

**Sweepstakes** (requires unlocked license)
- `GET /api/sweep/balance` — SC balance + compliance notice
- `POST /api/sweep/redeem` `{amount, stateCode, confirm18}` — request redemption
- `GET /api/sweep/redemptions` — own redemption history

## Socket.IO protocol (v1)

Client → server: `join`, `fold`, `check`, `call`, `raise {amount}`, `leave`
Server → client: `joined`, `room`, `yourTurn`, `handStart`, `handEnd`, `action`, `street`, `error`

Stale clients get `{code:'stale-client'}` — they must refresh.

## Payments

The platform ships with the payment *framework*. To go live:

1. **Stripe**: add `stripeSecretKey` + `stripePublishableKey` to `config/casino.json`,
   then implement the checkout session in `server/routes/api.js` (marked TODO).
2. **Crypto**: set `cryptoEnabled: true`, implement your provider (Coinbase Commerce, etc.).
3. Webhook credits coins automatically via `adjustBalance()`.

## Security

- **TLS**: set `FORCE_HTTPS=1` (or `NODE_ENV=production`) — the server redirects
  HTTP→HTTPS and sends HSTS. Always run behind a TLS-terminating proxy
  (Render/Cloudflare/nginx handle the certificate).
- **Secrets**: set `SESSION_SECRET` to a long random string. Never ship the default.
- **2FA**: enable it on the admin account first (`/admin` → Security).
- **RNG**: all shuffling uses the OS CSPRNG. See `docs/RNG-CERTIFICATION.md`
  for the independent-lab certification path (real-money operators).
- **Fair play**: IP-based collusion flagging runs automatically; review flags
  in the admin panel. Public trust page at `/security`.
- **Errors**: production mode never leaks stack traces to clients.

## What's next (roadmap)

- Blackjack engine (table config already has the slot)
- Tournament system
- Avatar builder + accessory shop
- iOS/Android wrappers
