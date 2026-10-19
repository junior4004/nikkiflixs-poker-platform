'use strict';
// Public API: auth, profile, coin packages, payments.
// Payment providers are pluggable — buyers configure their own keys in config/casino.json.

const express = require('express');
const fs = require('fs');
const path = require('path');
const { register, login, publicPlayer, authMiddleware, adjustBalance } = require('../auth');
const { stmts } = require('../db');

const router = express.Router();
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../../config/casino.json'), 'utf8'));

// ---- config (public, safe fields only) ----
router.get('/config', (req, res) => {
  const sweep = req.app.locals.sweep;
  res.json({
    ok: true,
    casino: config.casino,
    theme: config.theme,
    coins: { currencyName: config.coins.currencyName, packages: config.coins.packages },
    tables: config.tables.map(t => ({ id: t.id, name: t.name, felt: t.felt, game: t.game || 'holdem', maxPlayers: t.maxPlayers, smallBlind: t.smallBlind, bigBlind: t.bigBlind })),
    // sweepstakes details are ONLY exposed when a valid license unlocked them
    sweepstakes: sweep ? sweep.getPublicInfo() : { enabled: false },
  });
});

// ---- auth ----
router.post('/auth/register', async (req, res) => {
  const r = await register(req.body.username, req.body.password, req.body.displayName, config.coins.freeOnSignup);
  res.json(r);
});

router.post('/auth/login', async (req, res) => {
  const r = await login(req.body.username, req.body.password, req.body.totp);
  res.json(r);
});

router.get('/me', authMiddleware, (req, res) => {
  res.json({ ok: true, player: publicPlayer(req.player) });
});

router.get('/me/transactions', authMiddleware, (req, res) => {
  res.json({ ok: true, transactions: stmts.txHistory.all(req.player.id, 50) });
});

router.post('/me/avatar', authMiddleware, (req, res) => {
  const avatar = String(req.body.avatar || '').replace(/[^a-z0-9-]/gi, '').slice(0, 40);
  stmts.setAvatar.run(avatar, req.player.id);
  res.json({ ok: true, avatar });
});

// ---- two-factor authentication (TOTP) ----
// POST /api/2fa/setup → { secret, otpauthUrl } — scan/type into authenticator app, then confirm
router.post('/2fa/setup', authMiddleware, (req, res) => {
  const totp = require('../totp');
  const secret = totp.generateSecret();
  stmts.setTotp.run(secret, 0, req.player.id);
  const issuer = config.casino.name || 'Poker Platform';
  res.json({ ok: true, secret, otpauthUrl: totp.provisioningUri(secret, req.player.username, issuer) });
});

// POST /api/2fa/confirm { token } → enables 2FA after verifying a code
router.post('/2fa/confirm', authMiddleware, (req, res) => {
  const totp = require('../totp');
  const player = stmts.getById.get(req.player.id);
  if (!player.totp_secret) return res.status(400).json({ ok: false, error: 'no-setup' });
  if (!totp.verify(player.totp_secret, req.body.token)) return res.status(400).json({ ok: false, error: 'totp-invalid' });
  stmts.setTotp.run(player.totp_secret, 1, req.player.id);
  res.json({ ok: true });
});

// POST /api/2fa/disable { password } → turns 2FA off (requires password)
router.post('/2fa/disable', authMiddleware, async (req, res) => {
  const bcrypt = require('bcryptjs');
  const player = stmts.getById.get(req.player.id);
  const match = await bcrypt.compare(String(req.body.password || ''), player.password_hash);
  if (!match) return res.status(400).json({ ok: false, error: 'invalid-credentials' });
  stmts.setTotp.run(null, 0, req.player.id);
  res.json({ ok: true });
});

// ---- payments (framework — provider plug-in point) ----
router.get('/payments/providers', (req, res) => {
  res.json({
    ok: true,
    providers: {
      stripe: { enabled: !!config.payments.stripeSecretKey, publishableKey: config.payments.stripePublishableKey || null },
      crypto: { enabled: !!config.payments.cryptoEnabled },
    },
  });
});

// POST /api/payments/checkout { packageId, provider }
// Returns a checkout URL or client secret. Real provider calls go here.
router.post('/payments/checkout', authMiddleware, async (req, res) => {
  const pkg = config.coins.packages.find(p => p.id === req.body.packageId);
  if (!pkg) return res.status(400).json({ ok: false, error: 'bad-package' });
  const provider = req.body.provider || config.payments.provider;

  // STRIPE: buyer fills in keys in config/casino.json; uncomment to go live.
  if (provider === 'stripe' && config.payments.stripeSecretKey) {
    // const stripe = require('stripe')(config.payments.stripeSecretKey);
    // ... create checkout session, return url
    return res.json({ ok: false, error: 'stripe-not-configured', note: 'Add keys to config/casino.json' });
  }
  // CRYPTO / other providers plug in here.
  res.json({ ok: false, error: 'no-provider', note: 'Configure a payment provider in config/casino.json' });
});

// Webhook endpoint — providers call this after successful payment.
// POST /api/payments/webhook { playerId, packageId, providerRef }
router.post('/payments/webhook', (req, res) => {
  // TODO: verify provider signature before crediting.
  const { playerId, packageId } = req.body;
  const pkg = config.coins.packages.find(p => p.id === packageId);
  if (!pkg || !playerId) return res.status(400).json({ ok: false });
  const balance = adjustBalance(playerId, pkg.coins, 'purchase', `Coin purchase: ${pkg.id}`);
  // sweepstakes bonus (only when the licensed module is loaded)
  let sweepBonus = 0;
  const sweep = req.app.locals.sweep;
  if (sweep) sweepBonus = sweep.creditSweepBonus(playerId, pkg.id);
  res.json({ ok: true, balance, sweepBonus });
});

module.exports = router;
