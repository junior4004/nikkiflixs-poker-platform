// Cards and deck. A card is an object { rank, suit }:
// rank: 2..14 (11=J 12=Q 13=K 14=A), suit: 'c'|'d'|'h'|'s'
//
// SECURITY: shuffling uses a CSPRNG (node:crypto randomInt).
// Math.random is never used for game outcomes.

import { randomInt } from 'node:crypto'

export const SUITS = ['c', 'd', 'h', 's']
export const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]

const RANK_LABEL = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }
const SUIT_LABEL = { c: '♣', d: '♦', h: '♥', s: '♠' }
const SUIT_COLOR = { c: 'black', d: 'red', h: 'red', s: 'black' }

export function createDeck() {
  const deck = []
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit })
    }
  }
  return deck
}

// Fisher–Yates shuffle, CSPRNG-backed.
// The optional rng param exists ONLY for deterministic unit tests;
// production code must call shuffle(deck) with no second argument.
export function shuffle(deck, rng) {
  if (rng) {
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[deck[i], deck[j]] = [deck[j], deck[i]]
    }
    return deck
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomInt(i + 1) // uniform in [0, i], no modulo bias
    ;[deck[i], deck[j]] = [deck[j], deck[i]]
  }
  return deck
}

export function cardLabel(card) {
  if (!card) return ''
  return `${RANK_LABEL[card.rank] ?? card.rank}${SUIT_LABEL[card.suit] ?? card.suit}`
}

export function cardColor(card) {
  return SUIT_COLOR[card.suit] ?? 'black'
}
