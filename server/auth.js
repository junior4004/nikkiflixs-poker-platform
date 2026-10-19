'use strict';
// Player auth: register + login. Passwords hashed with bcrypt.
// Sessions = signed tokens (HMAC) stored client-side; server verifies per request.

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { stmts, adjustBalance } = require('./db');

const SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verify(token) {
  try {
    const [body, sig] = token.split('.');
    const expect = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
    if (sig !== expect) return null;
    return JSON.parse(Buffer.from(body, 'base64url').toString());
  } catch { return null; }
}

async function register(username, password, displayName, startingBalance) {
  username = String(username || '').trim().toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/.test(username)) return { ok: false, error: 'username-invalid' };
  if (String(password || '').length < 6) return { ok: false, error: 'password-too-short' };
  if (stmts.getByUsername.get(username)) return { ok: false, error: 'username-taken' };
  const hash = await bcrypt.hash(password, 10);
  const info = stmts.createPlayer.run(username, hash, displayName || username, startingBalance || 0);
  if (startingBalance > 0) stmts.addTx.run(info.lastInsertRowid, startingBalance, 'signup_bonus', 'Free coins on signup');
  const player = stmts.getById.get(info.lastInsertRowid);
  return { ok: true, player: publicPlayer(player), token: sign({ id: player.id }) };
}

async function login(username, password, totpCode) {
  username = String(username || '').trim().toLowerCase();
  const player = stmts.getByUsername.get(username);
  if (!player) return { ok: false, error: 'invalid-credentials' };
  if (player.banned) return { ok: false, error: 'banned' };
  const match = await bcrypt.compare(password, player.password_hash);
  if (!match) return { ok: false, error: 'invalid-credentials' };
  if (player.totp_enabled) {
    if (!totpCode) return { ok: false, error: 'totp-required' };
    const totp = require('./totp');
    if (!totp.verify(player.totp_secret, totpCode)) return { ok: false, error: 'totp-invalid' };
  }
  stmts.updateLogin.run(player.id);
  return { ok: true, player: publicPlayer(stmts.getById.get(player.id)), token: sign({ id: player.id }) };
}

function publicPlayer(p) {
  if (!p) return null;
  return { id: p.id, username: p.username, display_name: p.display_name, avatar: p.avatar, balance: p.balance, sweep_balance: p.sweep_balance || 0, is_admin: !!p.is_admin, totp_enabled: !!p.totp_enabled };
}

function authMiddleware(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  const payload = token && verify(token);
  if (!payload) return res.status(401).json({ ok: false, error: 'unauthorized' });
  const player = stmts.getById.get(payload.id);
  if (!player || player.banned) return res.status(401).json({ ok: false, error: 'unauthorized' });
  req.player = player;
  next();
}

function adminMiddleware(req, res, next) {
  if (!req.player || !req.player.is_admin) return res.status(403).json({ ok: false, error: 'forbidden' });
  next();
}

module.exports = { register, login, verify, publicPlayer, authMiddleware, adminMiddleware, adjustBalance };
