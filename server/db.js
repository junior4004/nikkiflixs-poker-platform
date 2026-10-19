'use strict';
// SQLite player accounts + transactions.
// Replaces localStorage: server-side balances, register/login, audit trail.

const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'poker-platform.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  avatar TEXT DEFAULT 'player-01',
  balance INTEGER NOT NULL DEFAULT 0,
  banned INTEGER NOT NULL DEFAULT 0,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login TEXT
);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL REFERENCES players(id),
  amount INTEGER NOT NULL,
  type TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tx_player ON transactions(player_id);
`);

// ---- Phase 2: sweepstakes + licensing schema --------------------------------
try { db.exec(`ALTER TABLE players ADD COLUMN sweep_balance INTEGER NOT NULL DEFAULT 0`); } catch {}
// ---- Professional tier: 2FA --------------------------------------------------
try { db.exec(`ALTER TABLE players ADD COLUMN totp_secret TEXT`); } catch {}
try { db.exec(`ALTER TABLE players ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0`); } catch {}

db.exec(`
CREATE TABLE IF NOT EXISTS licenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_key TEXT NOT NULL,
  type TEXT NOT NULL,
  casino TEXT,
  issued_at INTEGER,
  expires_at INTEGER,
  key_id TEXT,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS license_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS redemptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL REFERENCES players(id),
  sweep_amount INTEGER NOT NULL,
  usd_amount REAL NOT NULL,
  state_code TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_red_player ON redemptions(player_id);
CREATE INDEX IF NOT EXISTS idx_red_status ON redemptions(status);
`);
// ---- Professional tier: anti-collusion -------------------------------------
db.exec(`
CREATE TABLE IF NOT EXISTS collusion_flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  detail TEXT,
  reviewed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_col_table ON collusion_flags(table_id);
CREATE INDEX IF NOT EXISTS idx_col_reviewed ON collusion_flags(reviewed);
`);

const stmts = {
  createPlayer: db.prepare(`INSERT INTO players (username, password_hash, display_name, balance) VALUES (?, ?, ?, ?)`),
  getByUsername: db.prepare(`SELECT * FROM players WHERE username = ?`),
  getById: db.prepare(`SELECT * FROM players WHERE id = ?`),
  updateLogin: db.prepare(`UPDATE players SET last_login = datetime('now') WHERE id = ?`),
  setAvatar: db.prepare(`UPDATE players SET avatar = ? WHERE id = ?`),
  addBalance: db.prepare(`UPDATE players SET balance = balance + ? WHERE id = ?`),
  addTx: db.prepare(`INSERT INTO transactions (player_id, amount, type, note) VALUES (?, ?, ?, ?)`),
  listPlayers: db.prepare(`SELECT id, username, display_name, avatar, balance, banned, is_admin, created_at, last_login FROM players ORDER BY created_at DESC LIMIT ? OFFSET ?`),
  countPlayers: db.prepare(`SELECT COUNT(*) AS n FROM players`),
  banPlayer: db.prepare(`UPDATE players SET banned = ? WHERE id = ?`),
  txHistory: db.prepare(`SELECT * FROM transactions WHERE player_id = ? ORDER BY id DESC LIMIT ?`),
  // 2FA
  setTotp: db.prepare(`UPDATE players SET totp_secret = ?, totp_enabled = ? WHERE id = ?`),
  // collusion
  addCollusionFlag: db.prepare(`INSERT INTO collusion_flags (table_id, kind, detail) VALUES (?, ?, ?)`),
  listCollusionFlags: db.prepare(`SELECT * FROM collusion_flags WHERE (? = '' OR reviewed = ?) ORDER BY id DESC LIMIT ? OFFSET ?`),
  reviewCollusionFlag: db.prepare(`UPDATE collusion_flags SET reviewed = 1 WHERE id = ?`),
  // licensing
  addLicense: db.prepare(`INSERT INTO licenses (license_key, type, casino, issued_at, expires_at, key_id) VALUES (?, ?, ?, ?, ?, ?)`),
  revokeLicenses: db.prepare(`UPDATE licenses SET revoked = 1 WHERE type = ? AND revoked = 0`),
  getActiveLicense: db.prepare(`SELECT * FROM licenses WHERE type = ? AND revoked = 0 ORDER BY id DESC LIMIT 1`),
  addLicenseAudit: db.prepare(`INSERT INTO license_audit (action, detail) VALUES (?, ?)`),
  listLicenseAudit: db.prepare(`SELECT * FROM license_audit ORDER BY id DESC LIMIT ?`),
  // sweepstakes
  addSweepBalance: db.prepare(`UPDATE players SET sweep_balance = sweep_balance + ? WHERE id = ?`),
  getSweepBalance: db.prepare(`SELECT sweep_balance FROM players WHERE id = ?`),
  addRedemption: db.prepare(`INSERT INTO redemptions (player_id, sweep_amount, usd_amount, state_code, note) VALUES (?, ?, ?, ?, ?)`),
  listRedemptions: db.prepare(`SELECT r.*, p.username FROM redemptions r JOIN players p ON p.id = r.player_id WHERE (? = '' OR r.status = ?) ORDER BY r.id DESC LIMIT ? OFFSET ?`),
  getRedemption: db.prepare(`SELECT * FROM redemptions WHERE id = ?`),
  setRedemptionStatus: db.prepare(`UPDATE redemptions SET status = ?, note = ?, decided_at = datetime('now') WHERE id = ?`),
  myRedemptions: db.prepare(`SELECT * FROM redemptions WHERE player_id = ? ORDER BY id DESC LIMIT ?`),
};

function adjustSweepBalance(playerId, amount, type, note) {
  const tx = db.transaction(() => {
    stmts.addSweepBalance.run(amount, playerId);
    stmts.addTx.run(playerId, amount, type, note || '');
  });
  tx();
  return stmts.getSweepBalance.get(playerId).sweep_balance;
}

function adjustBalance(playerId, amount, type, note) {
  const tx = db.transaction(() => {
    stmts.addBalance.run(amount, playerId);
    stmts.addTx.run(playerId, amount, type, note || '');
  });
  tx();
  return stmts.getById.get(playerId).balance;
}

module.exports = { db, stmts, adjustBalance, adjustSweepBalance };
