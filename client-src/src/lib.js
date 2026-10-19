// Shared client utilities: card display, avatars, countdown, table layout.

export const RANK_LABEL = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }
export const SUIT_LABEL = { c: '♣', d: '♦', h: '♥', s: '♠' }

export function isRedSuit(suit) {
  return suit === 'd' || suit === 'h'
}

export function rankText(rank) {
  return String(RANK_LABEL[rank] ?? rank)
}

export const AVATARS = [
  '/avatars/player-01.webp',
  '/avatars/player-02.webp',
  '/avatars/player-03.webp',
  '/avatars/player-04.webp',
  '/avatars/player-05.webp',
  '/avatars/player-06.webp',
  '/avatars/player-07.webp',
  '/avatars/player-08.webp',
  '/avatars/player-09.webp',
  '/avatars/player-10.webp',
  '/avatars/player-11.webp',
  '/avatars/player-12.webp',
  '/avatars/player-13.webp',
  '/avatars/player-14.webp',
  '/avatars/player-15.webp',
  '/avatars/player-16.webp',
  '/avatars/player-17.webp',
  '/avatars/player-18.webp',
  '/avatars/player-19.webp',
  '/avatars/player-20.webp',
  '/avatars/player-21.webp',
  '/avatars/player-22.webp',
  '/avatars/player-23.webp',
  '/avatars/player-24.webp',
]

// Nikkiflixs dealer avatar (Nikki)
export const DEALER_AVATAR = '/avatars/nikki.png'

// True when the value is an image-avatar path (vs legacy emoji text)
export function isImgAvatar(v) {
  return typeof v === 'string' && v.startsWith('/avatars/')
}

export function avatarFor(name) {
  let h = 0
  for (const ch of String(name)) h = (h * 31 + ch.codePointAt(0)) >>> 0
  return AVATARS[h % AVATARS.length]
}

export const PHASE_NAMES = {
  waiting: 'Waiting',
  preflop: 'Pre-flop',
  flop: 'Flop',
  turn: 'Turn',
  river: 'River',
  showdown: 'Showdown',
  handEnd: 'Results',
}

// Table layout: n seats evenly distributed around an ellipse, starting at the
// bottom and going clockwise. Returns each seat's {x, y} (percent) plus the
// bet-chip position toward the center {bx, by}.
export function tableLayout(n) {
  const pts = []
  for (let i = 0; i < n; i++) {
    const a = Math.PI / 2 - (i * 2 * Math.PI) / n // y axis points down; subtracting goes clockwise
    const cos = Math.cos(a)
    const sin = Math.sin(a)
    pts.push({
      x: 50 + 39 * cos,
      y: 47 + 36 * sin,
      bx: 50 + 20 * cos,
      by: 47 + 18 * sin,
      dx: 50 + 28 * cos, // dealer button position
      dy: 47 + 26 * sin,
    })
  }
  return pts
}

// Estimate server/local clock offset for countdowns
let clockSkew = 0
export function syncClock(serverTime) {
  if (typeof serverTime === 'number') clockSkew = serverTime - Date.now()
}
export function now() {
  return Date.now() + clockSkew
}
