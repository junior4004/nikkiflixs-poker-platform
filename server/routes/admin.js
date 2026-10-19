'use strict';
// Admin API: player management, table monitoring, coin adjustments.
// All routes require admin auth.

const express = require('express');
const { stmts, adjustBalance } = require('../db');
const { authMiddleware, adminMiddleware, publicPlayer } = require('../auth');

const router = express.Router();
router.use(authMiddleware, adminMiddleware);

// GET /api/admin/players?limit=50&offset=0
router.get('/players', (req, res) => {
  const limit = Math.min(200, parseInt(req.query.limit) || 50);
  const offset = parseInt(req.query.offset) || 0;
  const players = stmts.listPlayers.all(limit, offset);
  const total = stmts.countPlayers.get().n;
  res.json({ ok: true, players, total });
});

// GET /api/admin/players/:id
router.get('/players/:id', (req, res) => {
  const p = stmts.getById.get(req.params.id);
  if (!p) return res.status(404).json({ ok: false, error: 'not-found' });
  const txs = stmts.txHistory.all(p.id, 50);
  res.json({ ok: true, player: publicPlayer(p), transactions: txs });
});

// POST /api/admin/players/:id/ban { banned: true/false }
router.post('/players/:id/ban', (req, res) => {
  stmts.banPlayer.run(req.body.banned ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

// POST /api/admin/players/:id/adjust { amount, note }
router.post('/players/:id/adjust', (req, res) => {
  const amount = parseInt(req.body.amount);
  if (!Number.isFinite(amount) || amount === 0) return res.status(400).json({ ok: false, error: 'bad-amount' });
  const balance = adjustBalance(req.params.id, amount, 'admin_adjust', req.body.note || `Admin adjustment by ${req.player.username}`);
  res.json({ ok: true, balance });
});

// GET /api/admin/tables — live table status (injected rooms)
router.get('/tables', (req, res) => {
  const rooms = req.app.locals.rooms;
  res.json({ ok: true, tables: rooms.listTables() });
});

// GET /api/admin/stats — basic analytics
router.get('/stats', (req, res) => {
  const totalPlayers = stmts.countPlayers.get().n;
  const tables = req.app.locals.rooms.listTables();
  const seated = tables.reduce((n, t) => n + t.players, 0);
  res.json({ ok: true, totalPlayers, tables: tables.length, seated, uptime: process.uptime() });
});

// ---- licensing ----
// POST /api/admin/license/activate { key }
router.post('/license/activate', (req, res) => {
  const lic = require('../license');
  const r = lic.activateLicense(req.body.key, req.player.username);
  if (r.ok && r.payload.type === 'sweepstakes') {
    // hot-load the encrypted module without a restart
    try { req.app.locals.mountSweepstakes(); } catch (e) { /* logged in mount */ }
  }
  res.json({ ok: r.ok, error: r.error, type: r.payload && r.payload.type, casino: r.payload && r.payload.casino });
});

// GET /api/admin/license/status
router.get('/license/status', (req, res) => {
  const lic = require('../license');
  const scrub = (p) => p ? { type: p.type, casino: p.casino, issued: p.issued, expires: p.expires, id: p.id } : null;
  res.json({
    ok: true,
    sweepstakesUnlocked: lic.sweepstakesUnlocked(),
    gold: scrub(lic.getActiveLicense('gold')),
    sweepstakes: scrub(lic.getActiveLicense('sweepstakes')),
  });
});

// GET /api/admin/license/audit
router.get('/license/audit', (req, res) => {
  res.json({ ok: true, audit: stmts.listLicenseAudit.all(100) });
});

// ---- anti-collusion ----
// GET /api/admin/collusion/flags?reviewed=&limit=50&offset=0
router.get('/collusion/flags', (req, res) => {
  const reviewed = req.query.reviewed === '' ? '' : (req.query.reviewed === '1' ? 1 : (req.query.reviewed === '0' ? 0 : ''));
  const limit = Math.min(200, parseInt(req.query.limit) || 50);
  const offset = parseInt(req.query.offset) || 0;
  res.json({ ok: true, flags: stmts.listCollusionFlags.all(reviewed, reviewed === '' ? '' : reviewed, limit, offset) });
});

// POST /api/admin/collusion/flags/:id/review
router.post('/collusion/flags/:id/review', (req, res) => {
  stmts.reviewCollusionFlag.run(req.params.id);
  res.json({ ok: true });
});

// GET /api/admin/collusion/analyze?table=<id> — heuristic stub (v0)
router.get('/collusion/analyze', (req, res) => {
  const collusion = require('../collusion');
  res.json({ ok: true, analysis: collusion.analyze(req.query.table || '') });
});

module.exports = router;
