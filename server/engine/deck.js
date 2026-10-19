'use strict';
// Deck: 52-card deck with Fisher-Yates shuffle.
// Cards represented as { rank: 0-12 (2..A), suit: 0-3 (♠♥♦♣) }.
//
// SECURITY: shuffling uses a CSPRNG (crypto.randomInt) via server/rng.js.
// Math.random is never used for game outcomes.

const { cryptoShuffle } = require('../rng');

const SUITS = ['s', 'h', 'd', 'c']; // spades, hearts, diamonds, clubs
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

function newDeck() {
  const cards = [];
  for (let s = 0; s < 4; s++) {
    for (let r = 0; r < 13; r++) {
      cards.push({ rank: r, suit: s });
    }
  }
  return cards;
}

// Fisher-Yates shuffle (in place), CSPRNG-backed.
// The optional rng param exists ONLY for deterministic unit tests;
// production code must call shuffle(deck) with no second argument.
function shuffle(deck, rng) {
  if (rng) {
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }
  return cryptoShuffle(deck);
}

function cardToString(c) {
  return RANKS[c.rank] + SUITS[c.suit];
}

function cardFromString(str) {
  // e.g. "As", "Td"
  const rank = RANKS.indexOf(str[0].toUpperCase());
  const suit = SUITS.indexOf(str[1].toLowerCase());
  if (rank < 0 || suit < 0) throw new Error('Bad card string: ' + str);
  return { rank, suit };
}

module.exports = { newDeck, shuffle, cardToString, cardFromString, SUITS, RANKS };
