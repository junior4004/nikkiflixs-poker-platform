#!/usr/bin/env node
'use strict';
// Nikkiflixs Poker Platform — license key generator.
// RUN OFFLINE, ON JERRY'S MACHINE ONLY. Never ship .license-private.key.
//
// Usage:
//   node tools/gen-license.js --type gold --casino "Acme Casino" --days 365
//   node tools/gen-license.js --type sweepstakes --casino "Acme Casino" --days 365
//
// Output: a license key like NPK1.<payload>.<signature>
// The buyer pastes it into the admin panel. The server verifies the Ed25519
// signature against the embedded public key — it cannot be forged.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PRIV_PATH = path.join(__dirname, '.license-private.key');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

function main() {
  const type = arg('type', 'gold');
  const casino = arg('casino', 'Unnamed Casino');
  const days = parseInt(arg('days', '365'), 10);
  if (!['gold', 'sweepstakes'].includes(type)) {
    console.error('type must be gold or sweepstakes');
    process.exit(1);
  }
  if (!fs.existsSync(PRIV_PATH)) {
    console.error('Missing ' + PRIV_PATH + ' — private key not found. Cannot sign.');
    process.exit(1);
  }
  const privPem = fs.readFileSync(PRIV_PATH, 'utf8');
  const privateKey = crypto.createPrivateKey(privPem);

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    v: 1,
    type,
    casino: String(casino).slice(0, 80),
    issued: now,
    expires: now + days * 86400,
    id: crypto.randomBytes(8).toString('hex'),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.sign(null, Buffer.from(body), privateKey).toString('base64url');
  const key = `NPK1.${body}.${sig}`;

  console.log('==============================================');
  console.log('LICENSE KEY (' + type.toUpperCase() + ')');
  console.log('==============================================');
  console.log(key);
  console.log('');
  console.log('Casino : ' + payload.casino);
  console.log('Type   : ' + payload.type);
  console.log('Expires: ' + new Date(payload.expires * 1000).toISOString().slice(0, 10));
  console.log('');
  console.log('Give this key to the buyer AFTER verifying legal compliance');
  console.log('(for sweepstakes type). They paste it into Admin > Sweepstakes.');
}

main();
