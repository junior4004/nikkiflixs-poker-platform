'use strict';
// Nikkiflixs Poker Platform — license verification + sweepstakes unlock.
//
// Two-tier model:
//   gold        — base platform, gold coins only (no sweepstakes code runs)
//   sweepstakes — unlocks the encrypted sweepstakes module (dual currency,
//                 redemptions). Issued ONLY after the buyer proves legal
//                 compliance; Jerry signs the key offline with gen-license.js.
//
// The sweepstakes module ships as AES-256-GCM ciphertext (sweepstakes.enc).
// Its key is NOT stored as a literal anywhere in this file: it is split
// into XOR shares, each masked, and reassembled only after a valid
// sweepstakes license verifies. Forging a license requires breaking Ed25519;
// extracting the key requires reverse-engineering this derivation. Both are
// real effort — this is a good-faith lock, and cracking it voids the license
// (see SWEEPSTAKES-ADDENDUM.txt).

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const { db, stmts } = require('./db');

// ---- Jerry's public key (safe to distribute; verifies signatures only) ----
const LICENSE_PUBKEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAS8x0NguJh+ANOvnNXN7Ir363PZTDBEIZ6Vvm7QndTgY=
-----END PUBLIC KEY-----`;

// ---- Obfuscated AES-256 key shares for sweepstakes.enc ----------------------
// K = S1 ^ S2 ^ S3 ^ S4 ; each stored as base64( Si XOR mask_i )
const _m1 = 'gold-coins-forever-01';
const _m2 = 'sweepstakes-vault-02';
const _m3 = 'nikkiflixs-license-03';
const _m4 = 'platform-shield-04';
const _s1 = 'CC1w+axsZG9s0gNeAf7Ww7zUU5KMRFn0rEzIdFxzf/o=';
const _s2 = '8D4IdvDZZcEbGo9UvQIqgrCbD168AU6ZOEcGG/Nrjd0=';
const _s3 = '6f6dZFLwKwbfQTbFA/SzWgBBE9d9oxpcsyMSNswPKAg=';
const _s4 = 'x3MB/KLAtJOCAsKlfi+Q3ngZkgYmz3Kw+exATphi6oM=';

function _unmask(enc, mask) {
  const e = Buffer.from(enc, 'base64');
  const m = Buffer.from(mask);
  const out = Buffer.alloc(e.length);
  for (let i = 0; i < e.length; i++) out[i] = e[i] ^ m[i % m.length];
  return out;
}

function revealSweepKey() {
  const parts = [_unmask(_s1, _m1), _unmask(_s2, _m2), _unmask(_s3, _m3), _unmask(_s4, _m4)];
  const key = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) key[i] = parts[0][i] ^ parts[1][i] ^ parts[2][i] ^ parts[3][i];
  return key;
}

// ---- License verification ---------------------------------------------------
function verifyLicense(key) {
  try {
    const parts = String(key || '').trim().split('.');
    if (parts.length !== 3 || parts[0] !== 'NPK1') return { ok: false, error: 'bad-format' };
    const [, body, sig] = parts;
    const pub = crypto.createPublicKey(LICENSE_PUBKEY);
    const valid = crypto.verify(null, Buffer.from(body), pub, Buffer.from(sig, 'base64url'));
    if (!valid) return { ok: false, error: 'bad-signature' };
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.v !== 1) return { ok: false, error: 'bad-version' };
    if (!['gold', 'sweepstakes'].includes(payload.type)) return { ok: false, error: 'bad-type' };
    const now = Math.floor(Date.now() / 1000);
    if (payload.expires < now) return { ok: false, error: 'expired' };
    return { ok: true, payload };
  } catch {
    return { ok: false, error: 'invalid' };
  }
}

function audit(action, detail) {
  try { stmts.addLicenseAudit.run(action, detail || ''); } catch {}
}

function activateLicense(key, activatedBy) {
  const v = verifyLicense(key);
  if (!v.ok) { audit('activate_rejected', v.error); return v; }
  const p = v.payload;
  // revoke any prior active license of the same type, then store the new one
  stmts.revokeLicenses.run(p.type);
  stmts.addLicense.run(key, p.type, p.casino, p.issued, p.expires, p.id);
  audit('activated', `${p.type} license for "${p.casino}" (id ${p.id}), expires ${new Date(p.expires * 1000).toISOString().slice(0, 10)}, by ${activatedBy || 'admin'}`);
  return { ok: true, payload: p };
}

function getActiveLicense(type) {
  const row = stmts.getActiveLicense.get(type || 'sweepstakes');
  if (!row) return null;
  const v = verifyLicense(row.license_key);
  if (!v.ok || v.payload.expires < Math.floor(Date.now() / 1000)) {
    stmts.revokeLicenses.run(row.type);
    return null;
  }
  return v.payload;
}

function sweepstakesUnlocked() {
  return !!getActiveLicense('sweepstakes');
}

// ---- Encrypted sweepstakes module loading ------------------------------------
let _sweepModule = null;

function loadSweepstakesModule() {
  if (_sweepModule) return _sweepModule;
  if (!sweepstakesUnlocked()) return null;
  const encPath = path.join(__dirname, 'sweepstakes.enc');
  if (!fs.existsSync(encPath)) throw new Error('sweepstakes.enc missing');
  const blob = JSON.parse(fs.readFileSync(encPath, 'utf8'));
  const key = revealSweepKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(blob.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(blob.tag, 'base64'));
  let src;
  try {
    src = decipher.update(blob.data, 'base64', 'utf8') + decipher.final('utf8');
  } catch {
    audit('decrypt_failed', 'sweepstakes.enc failed authentication — possible tampering');
    throw new Error('Sweepstakes module failed integrity check');
  }
  // compile as a CommonJS module in-memory (never written to disk decrypted)
  const m = new Module('sweepstakes', module);
  m._compile(src, path.join(__dirname, 'sweepstakes.module.js'));
  _sweepModule = m.exports;
  audit('module_loaded', 'Sweepstakes module decrypted and loaded');
  return _sweepModule;
}

module.exports = {
  verifyLicense, activateLicense, getActiveLicense,
  sweepstakesUnlocked, loadSweepstakesModule, audit,
};
