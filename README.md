# Poker Platform (white-label)

Sellable multiplayer poker platform — professional tier, built to compete
with the $50K–$80K platforms at a disruptive price.

## Status: Phase 2 complete (2026-10-17)

**Working:**
- ✅ Poker engine (server-authoritative Texas Hold'em, 4 tables from config)
- ✅ Free-table game server (blue/purple 5-player, same port at `/ft`)
- ✅ Player accounts (register/login, bcrypt passwords, SQLite)
- ✅ Server-side balances + transaction ledger
- ✅ Admin panel (`/admin` — tables, players, ban/unban, coin adjust, collusion flags, license activation, 2FA)
- ✅ White-label config (`config/casino.json` — rebrand without code changes)
- ✅ Payment framework (Stripe/crypto plug-in points)
- ✅ Sweepstakes mode — encrypted module, license-gated, dual currency, redemption queue
- ✅ 2FA (TOTP) for players and admins
- ✅ Anti-collusion — IP tracking per table, shared-IP auto-flags, heuristic stub
- ✅ CSPRNG shuffling (no Math.random in game outcomes) + RNG cert doc
- ✅ TLS enforcement (HSTS), security headers, no stack leaks in production
- ✅ Public security & fair-play page (`/security`, white-labeled)
- ✅ Socket.IO protocol v1 with stale-client rejection

**Tested:**
- Register → login → bad-password rejected; 2FA setup → confirm → totp-required → login with code
- Sweepstakes: license gen → activate → unlock → bonus on purchase → redeem validations → approve
- Collusion: two same-IP joins → flag → admin review
- License: valid verifies, tampered rejected, expired rejected
- Free-table room create over `/ft/socket.io`

## Layout

```
poker-platform/
├── config/casino.json      # white-label config (THE file buyers edit)
├── LICENSE.txt             # gold-coins-only license terms
├── SWEEPSTAKES-ADDENDUM.txt# sweepstakes activation terms
├── server/
│   ├── server.js           # Express + Socket.IO, wires everything
│   ├── db.js               # SQLite: players, transactions, licenses, redemptions, flags
│   ├── auth.js             # register/login (2FA-aware), sessions, middleware
│   ├── totp.js             # TOTP 2FA (RFC 6238, dependency-free)
│   ├── rng.js              # CSPRNG shuffle/rand helpers
│   ├── collusion.js        # IP tracking + flagging + heuristic stub
│   ├── license.js          # Ed25519 license verify, encrypted module loader
│   ├── sweepstakes.enc     # encrypted sweepstakes module (license-gated)
│   ├── seed.js             # create admin: node seed.js <user> <pass>
│   ├── engine/             # poker engine (deck, evaluator, pokerEngine)
│   ├── freetable/          # free-table game server source (5-player)
│   ├── freetable-adapter.cjs # mounts it at /ft on the same port
│   ├── public/security.html# fair-play page template
│   └── routes/
│       ├── api.js          # public API + payments + 2FA
│       └── admin.js        # admin API (players, licenses, collusion, sweep)
├── admin/index.html        # admin panel (no build step)
├── client/                 # built table UI (React build output)
├── client-src/             # table UI source (rebuild → client/)
├── tools/
│   ├── gen-license.js      # OFFLINE: sign license keys (Jerry only)
│   ├── build-sweepstakes.js# rebuild sweepstakes.enc from plaintext
│   ├── sweep-src/          # DEV SOURCE ONLY — never ship
│   ├── .license-private.key# JERRY'S MASTER KEY — guard with your life
│   └── .sweep-aes.key      # module encryption key — never ship
└── docs/
    ├── SETUP.md            # buyer setup guide (<1 hr deploy)
    └── RNG-CERTIFICATION.md# iTech/GLI/BMM path for real-money operators
```

## Tiers

| | Gold ($20K) | Sweepstakes ($60K) |
|---|---|---|
| Everything above | ✅ | ✅ |
| Sweepstakes dual currency | 🔒 encrypted | ✅ unlocked via license key |
| Redemption queue | — | ✅ |

Sweepstakes unlock requires the buyer to prove legal compliance first.
See SWEEPSTAKES-ADDENDUM.txt.

## Phase 3 (next)

- [ ] Blackjack engine
- [ ] Stripe checkout implementation (keys → working payments)
- [ ] Tournament system
- [ ] Demo mode (try-before-buy)
- [ ] Behavioral collusion heuristics (chip-dump / soft-play detection)

## Notes

- `SESSION_SECRET` env var must be set in production.
- `FORCE_HTTPS=1` (or `NODE_ENV=production`) enforces HTTPS + HSTS.
- SQLite is fine for <10K players; switch to Postgres for scale (db.js is the seam).
- `tools/` contains Jerry's private keys — NEVER include in buyer distributions.
