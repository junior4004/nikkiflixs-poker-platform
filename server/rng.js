'use strict';
// Cryptographically secure RNG for card shuffling and game randomness.
//
// Uses Node's crypto.randomInt (CSPRNG, uniform distribution, no modulo
// bias). Math.random is a PRNG and MUST NOT be used for shuffling or any
// game outcome.
//
// For real-money operation, buyers should pursue RNG certification
// (iTech Labs, GLI, BMM). See docs/RNG-CERTIFICATION.md for the path.

const crypto = require('crypto');

/**
 * Fisher-Yates shuffle using a CSPRNG. Returns the deck (shuffled in place).
 * @param {Array} deck
 */
function cryptoShuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1); // uniform in [0, i]
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/**
 * Uniform random integer in [min, max] inclusive.
 */
function randInt(min, max) {
  return crypto.randomInt(min, max + 1);
}

/**
 * Random hex token (for nonces, salts, etc.).
 */
function randomHex(bytes = 16) {
  return crypto.randomBytes(bytes).toString('hex');
}

module.exports = { cryptoShuffle, randInt, randomHex };
