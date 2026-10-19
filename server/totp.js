'use strict';
// TOTP two-factor authentication (RFC 6238 / RFC 4226), dependency-free.
// Secrets are base32-encoded; codes are 6 digits, 30-second steps, SHA-1.

const crypto = require('crypto');

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const b of buf) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) { out += BASE32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/=+$/, '').replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0;
  const bytes = [];
  for (const ch of clean) {
    value = (value << 5) | BASE32.indexOf(ch);
    bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(bytes);
}

function generateSecret(bytes = 20) {
  return base32Encode(crypto.randomBytes(bytes));
}

function hotp(secret, counter) {
  const key = base32Decode(secret);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(code % 1000000).padStart(6, '0');
}

function totpNow(secret, forTime = Date.now()) {
  return hotp(secret, Math.floor(forTime / 30000));
}

/**
 * Verify a 6-digit code, allowing ±1 step clock skew (default window 1).
 */
function verify(secret, token, window = 1) {
  const t = String(token || '').replace(/\D/g, '');
  if (!/^\d{6}$/.test(t)) return false;
  const step = Math.floor(Date.now() / 30000);
  for (let d = -window; d <= window; d++) {
    if (hotp(secret, step + d) === t) return true;
  }
  return false;
}

function provisioningUri(secret, accountName, issuer) {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const params = `secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
  return `otpauth://totp/${label}?${params}`;
}

module.exports = { generateSecret, totpNow, verify, provisioningUri, base32Decode };
