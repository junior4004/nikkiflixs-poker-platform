# Sweepstakes Module — Verification & Interface

**Verified:** 2026-10-18 (read-only verification; nothing modified, rebuilt, re-encrypted, or copied)
**Auditor:** Johnny 5 (subagent, parent orchestrator)

---

## 1. Verification results — ALL PASS

| Check | Result |
|---|---|
| `.sweep-aes.key` decrypts `server/sweepstakes.enc` | **PASS** — AES-256-GCM authenticates (auth tag verified), plaintext 5,056 chars |
| Decrypted plaintext compiles as a CommonJS module | **PASS** — exports `{ mount }`, single function `mount` |
| Decrypted plaintext == `tools/sweep-src/sweepstakes.js` | **PASS** — SHA-256 hashes match (encrypted blob was built from the source on file) |
| `license.js` derived key (XOR shares + masks) == `.sweep-aes.key` | **PASS** — buffers compare equal; **key never shipped in the buyer build** (derived at runtime after license check) |
| Ed25519 keypair self-consistent (private → public == `.license-public.key`) | **PASS** |
| `license.js` embedded `LICENSE_PUBKEY` == `.license-public.key` | **PASS** |
| `gen-license.js` sign → `license.js verifyLicense()` round trip (type sweepstakes) | **PASS** — `NPK1.<payload>.<signature>` accepted |
| Tampered signature rejected | **PASS** — `bad-signature` |
| Expired license rejected | **PASS** — `expired` |
| Decryption side channel | none — decrypt done in memory, no plaintext written to disk |

**Key hygiene notes (no values disclosed):**
- Private keys live ONLY on this VM: `tools/.license-private.key` (600), `tools/.sweep-aes.key` (600). Public key is world-readable (600→rw-r—r—), as designed.
- The buyer build ships **only**: `server/sweepstakes.enc` + the embedded public key in `license.js` + XOR-masked shares. The raw AES key and the Ed25519 private key never leave this VM.
- `tools/.sweep-shares.json` (600) holds the same masked shares embedded in `license.js` — keep it here as the build record; do not ship.

---

## 2. Module exported interface

**File (plaintext source):** `tools/sweep-src/sweepstakes.js`
**Buyer artifact:** `server/sweepstakes.enc` (AES-256-GCM JSON blob: `{ v, alg, iv, tag, data }`)
**Exports:** `module.exports = { mount }` — one function, no other surface.

### `mount(ctx) -> { creditSweepBonus, getPublicInfo }`

**`ctx` the server must provide** (all exist in `server.js`/`db.js` today):
- `app` — Express app (module registers routes directly)
- `authMiddleware`, `adminMiddleware` — player/admin guards
- `stmts` — must include `getSweepBalance`, `myRedemptions`, `addRedemption`, `listRedemptions`, `getRedemption`, `setRedemptionStatus` (all exist)
- `adjustSweepBalance(playerId, amount, type, note)` — atomic balance + tx-log write (exists in `db.js`)
- `getSweepConfig()` — returns `config.sweepstakes` from `config/casino.json`
- `auditLicense(action, detail)` — license audit trail

**Player endpoints registered:**
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/sweep/balance` | SC balance + currency name + compliance notice/min-age/excluded-states |
| GET | `/api/sweep/redemptions` | Last 50 redemption requests for the player |
| POST | `/api/sweep/redeem` `{ amount, stateCode, confirm18 }` | Redemption request: validates 18+ confirm, `>= minRedeem`, state not excluded, sufficient SC; computes USD = `amount × redeemRate`; writes `pending` row, debits SC immediately |

**Admin endpoints registered:**
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/sweep/redemptions?status=&limit=&offset=` | Queue listing (status filter, ≤200) |
| POST | `/api/admin/sweep/redemptions/:id/approve` | Sets `approved`; audit-logged; **prize fulfillment is offline by the operator** |
| POST | `/api/admin/sweep/redemptions/:id/deny` | Sets `denied`, **refunds the SC** to the player, audit-logged |

**Returned handle:**
- `creditSweepBonus(playerId, packageId)` — called by the server after a gold-coin purchase; looks up `config.sweepstakes.purchaseBonus[packageId]` (e.g. starter→5, regular→30, highroller→200) and credits SC as a **free bonus** ("no purchase necessary — see terms"). Returns 0 if no bonus configured.
- `getPublicInfo()` — `{ enabled:true, currencyName, shortName, minRedeem, redeemRate, complianceNotice, minAge, excludedStates }` for unauthenticated display.

**Dual currency model:** Gold Coins (purchased, no cash value) vs Sweepstakes Coins (free bonus with purchase, or free via mail-in/free-play). SC is stored in `players.sweep_balance` (separate column, default 0). Redemption requires min SC and excluded-state checks; the **server never fulfills prizes** — admin approve/deny is a workflow queue, actual payout is offline.

**`config/casino.json` → `sweepstakes` fields consumed:** `mode` (`"locked"` by default), `currencyName`, `shortName`, `purchaseBonus`, `redeemRate`, `minRedeem`, `minAge`, `excludedStates`, `complianceNotice`.

---

## 3. License-gating flow

1. **Build (this VM only):** `tools/build-sweepstakes.js` encrypts `tools/sweep-src/sweepstakes.js` with `.sweep-aes.key` → `server/sweepstakes.enc`. (Buyer build = encrypted file only; never ship `tools/sweep-src/`.)
2. **Sign (this VM, offline, on Jerry's order):** `node tools/gen-license.js --type gold|sweepstakes --casino "..." --days N` → `NPK1.<base64url-payload>.<base64url-sig>`. Payload: `{ v:1, type, casino, issued, expires, id }`. Signed with `.license-private.key`. **Sweepstakes keys are issued ONLY after the buyer proves legal compliance.**
3. **Verify (buyer server):** `license.js verifyLicense()` — format check, Ed25519 verify against embedded public key, `v===1`, type in {gold, sweepstakes}, not expired. Forged licenses fail signature; expired fail expiry.
4. **Activate (admin):** `POST` license → `activateLicense()` revokes prior same-type license, stores new one in `licenses` table + audit entry. Admin route re-runs `mountSweepstakes()` on sweepstakes-type activation (`server/routes/admin.js`).
5. **Unlock:** `sweepstakesUnlocked()` reads active non-revoked, non-expired license. `loadSweepstakesModule()` derives the AES key from XOR shares **only after unlock**, decrypts in memory, compiles as CommonJS, caches.
6. **Wire-in:** `server.js` `mountSweepstakes()` at boot sets `app.locals.sweep`; `routes/api.js` public info exposes `sweepstakes: sweep ? sweep.getPublicInfo() : { enabled:false }` (locked buyers see `{ enabled:false }` — no sweepstakes details leak); purchase endpoint calls `sweep.creditSweepBonus()` **only when the licensed module is loaded**. Without a license the server logs `Sweepstakes mode: LOCKED (gold coins only)`.

**Tamper response:** GCM auth-tag failure → `decrypt_failed` audit + error; module never partially loads.

---

## 4. Table changes needed for sweepstakes-coin support

**Today:** `~/workspace/node-migration/bot-build/nikkiflixs-server/public/emerald-node.html` and `red-node.html` are **gold-coin only**:
- Single account variable `bank` (gold balance); single `stacks[]` and `pot` (integers, no currency tag).
- Balance display: lobby pill `GOLD COINS` (red), `money()` = `'$'+…` on emerald / `'GC '+…` on red.
- Chip modal: "Account chips → Add to table" moves gold from account to stack; raise modal presets (half pot / pot / all-in) are gold-denominated.
- Server `join` defaults buy-in from `player.balance` (gold only); poker engine is currency-agnostic integers (good — no engine rewrite needed).

### Checklist

**Server (poker-platform, applies to any table client):**
- [ ] Add `currency` to the `join` message (`{ table, token, session, buyIn, currency: 'gold'|'sc' }`); validate against active sweepstakes license — **reject `sc` joins when locked**.
- [ ] Buy-in sourcing: `player.balance` for gold, `player.sweep_balance` for SC (currently only `player.balance`).
- [ ] Table-level currency: tag each table (e.g. `config.tables[].currency` or per-room `currency` field) — **one currency per table** (never mixed pots; engine stays integer-based, no changes to `pokerEngine.js` needed).
- [ ] Emit `currency` in `engine.getState()` / `syncTable` so clients display the right label (pot, stacks, bets are all the same currency).
- [ ] Cash-out / leave-table: route stack back to the matching account column (`balance` vs `sweep_balance`).
- [ ] Block SC tables for players in excluded states / under min age (config `excludedStates`, `minAge`).

**Table UI (emerald-node.html + red-node.html):**
- [ ] Balance display: show BOTH balances (Gold Coins + SC pill), or the active table's currency; keep `money()` currency-aware (label switch `'GC '` ↔ `'SC '` / `$`).
- [ ] Buy-in / chip modal: currency selector (Gold vs SC) — disabled/locked when sweepstakes not unlocked; pulls from the right account balance and validates minimum buy-in per currency.
- [ ] Pot & seat stacks: label with active currency; pot-win animation text (`'POT '+money(amount)`) must use table currency.
- [ ] Raise modal: presets and slider read from the currency-tagged state.
- [ ] **Redemption entry point:** player-facing link/button to `/api/sweep/redemptions` UI — "Redeem SC" opens a page/modal with: SC balance, USD rate, min-redeem, state selector, 18+ confirm, compliance notice; shows redemption history with pending/approved/denied status. (Not built yet anywhere.)
- [ ] Lobby: per-table currency badges (e.g. "SC tables" section), free-bonus explanation ("free SC with gold purchase — no purchase necessary"), compliance notice footer.
- [ ] Admin panel: redemptions approve/deny queue is server-only today (`/api/admin/sweep/...`); needs admin UI + the license-paste screen (partially present — `admin.js` has activate; verify UI polish).
- [ ] Free-play path: free SC via mail-in/free-play request (mentioned in module docs; no endpoint — operator manual credit via admin today).

**Guardrails (Jerry's standing rules):** SC tables MUST be gated behind `app.locals.sweep` (license), one currency per table, engine untouched. `money()` currently renders `$` on emerald — pick the canonical label (`SC` / `GC`) before launch so no real-currency implication leaks onto gold tables.

---

**Bottom line:** Keys ✓ self-consistent · module ✓ decrypts & compiles · plaintext matches source · license sign/verify/tamper/expiry ✓ all pass. The encrypted module is a clean, narrow API (`mount` → routes + 2 functions). Player tables need currency-selection UI, dual-balance display, table-currency tagging on the server, and a brand-new redemption UI — checklist above is the work list.
