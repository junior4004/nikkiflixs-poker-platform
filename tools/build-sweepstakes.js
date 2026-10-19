#!/usr/bin/env node
'use strict';
// Builds server/sweepstakes.enc from tools/sweep-src/sweepstakes.js.
// Run this on JERRY'S machine after editing the plaintext source.
// The AES key lives in tools/.sweep-aes.key (never ships).
// server/sweepstakes.enc is what buyers receive.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'sweep-src', 'sweepstakes.js');
const OUT = path.join(__dirname, '..', 'server', 'sweepstakes.enc');
const KEYFILE = path.join(__dirname, '.sweep-aes.key');

const key = Buffer.from(fs.readFileSync(KEYFILE, 'utf8').trim(), 'hex');
const src = fs.readFileSync(SRC, 'utf8');
const iv = crypto.randomBytes(12);
const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
const data = cipher.update(src, 'utf8', 'base64') + cipher.final('base64');
const tag = cipher.getAuthTag();
fs.writeFileSync(OUT, JSON.stringify({ v: 1, alg: 'aes-256-gcm', iv: iv.toString('base64'), tag: tag.toString('base64'), data }));
console.log('Wrote', OUT, `(${(fs.statSync(OUT).size / 1024).toFixed(1)} KB, encrypted)`);
console.log('Plaintext source remains in tools/sweep-src/ — DO NOT SHIP that directory.');
