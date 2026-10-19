import { useState } from 'react'
import { isRedSuit, rankText, SUIT_LABEL } from '../lib.js'

// Card image file naming: /cards/{RANK}{SUIT}.webp (e.g. AS, 10H, KD, 3C)
// Falls back to CSS rendering if the image fails to load.
const SUIT_CODE = { s: 'S', h: 'H', d: 'D', c: 'C' }

function cardImageSrc(card) {
  const rank = rankText(card.rank)
  const suit = SUIT_CODE[card.suit]
  return `/cards/${rank}${suit}.webp`
}

// A single playing card. A null/missing card renders the back.
// Uses 3D-rendered image cards when available, CSS fallback otherwise.
export default function Card({ card, size = 'md', dim = false }) {
  const [imgOk, setImgOk] = useState(true)
  const theme = typeof document !== 'undefined'
    ? document.documentElement.dataset.theme || 'blue'
    : 'blue'

  const cls = [
    'card',
    `card-${size}`,
    card ? (isRedSuit(card.suit) ? 'red' : 'black') : 'back',
    dim ? 'dim' : '',
  ]
    .filter(Boolean)
    .join(' ')

  if (!card) {
    return (
      <div className={cls} aria-label="face-down card">
        <img
          src={`/cards/card-back-${theme}.webp`}
          alt=""
          className="card-img"
          onError={(e) => { e.target.style.display = 'none' }}
        />
      </div>
    )
  }

  const src = cardImageSrc(card)

  if (imgOk) {
    return (
      <div className={`${cls} card-has-img`} aria-label={`${rankText(card.rank)}${SUIT_LABEL[card.suit]}`}>
        <img
          src={src}
          alt={`${rankText(card.rank)}${SUIT_LABEL[card.suit]}`}
          className="card-img"
          onError={() => setImgOk(false)}
        />
      </div>
    )
  }

  return (
    <div className={cls} aria-label={`${rankText(card.rank)}${SUIT_LABEL[card.suit]}`}>
      <span className="card-rank">{rankText(card.rank)}</span>
      <span className="card-suit">{SUIT_LABEL[card.suit]}</span>
    </div>
  )
}
