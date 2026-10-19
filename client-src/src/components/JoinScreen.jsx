import { useEffect, useState } from 'react'
import { AVATARS } from '../lib.js'
import SweepPanel from './SweepPanel.jsx'
import TwoFactorPanel from './TwoFactorPanel.jsx'

// Entry screen: platform account (sign in/register), nickname, avatar, then create or join a room.
export default function JoinScreen({ notice, onCreate, onJoin, platform, platformToken, onPlatformAuth }) {
  const [name, setName] = useState(() => localStorage.getItem('poker:name') || '')
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('r')?.toUpperCase() || '')
  const [rooms, setRooms] = useState([])
  const [chips, setChips] = useState('100')
  const [smallBlind, setSmallBlind] = useState('5')
  const [bigBlind, setBigBlind] = useState('10')
  const [rebuys, setRebuys] = useState('0')
  const [lang, setLang] = useState('zh')
  const [aiChat, setAiChat] = useState(true)
  const [icon, setIcon] = useState(() => localStorage.getItem('poker:icon') || '/avatars/player-01.webp')
  // platform account
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [totpInput, setTotpInput] = useState('')
  const [authErr, setAuthErr] = useState('')
  const [me, setMe] = useState(null)

  const casinoName = platform?.casino?.name || 'Nikkiflixs Poker Club'
  const tagline = platform?.casino?.tagline || 'Nikkiflixs Poker Club and Entertainment'
  const sweepEnabled = !!platform?.sweepstakes?.enabled

  useEffect(() => {
    if (!platformToken) { setMe(null); return }
    refreshMe()
  }, [platformToken]) // eslint-disable-line react-hooks/exhaustive-deps

  const refreshMe = () => {
    fetch('/api/me', { headers: { Authorization: 'Bearer ' + platformToken } })
      .then((r) => r.json())
      .then((r) => { if (r.ok) setMe(r.player) })
      .catch(() => {})
  }

  const doAuth = async (mode) => {
    setAuthErr('')
    try {
      const r = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, totp: totpInput || undefined }),
      }).then((x) => x.json())
      if (!r.ok) {
        setAuthErr(
          r.error === 'totp-required' ? 'Enter your 2FA code.' :
          r.error === 'totp-invalid' ? 'Wrong 2FA code.' :
          (r.error || 'failed')
        )
        return
      }
      onPlatformAuth(r.token)
      if (r.player?.display_name) saveName(r.player.display_name)
      if (r.player?.avatar) pickIcon(r.player.avatar.startsWith('/') ? r.player.avatar : `/avatars/${r.player.avatar}.webp`)
    } catch {
      setAuthErr('network error')
    }
  }

  const pickIcon = (e) => {
    setIcon(e)
    localStorage.setItem('poker:icon', e)
  }

  useEffect(() => {
    let alive = true
    const load = () =>
      fetch('/ft/api/rooms')
        .then((r) => r.json())
        .then((list) => alive && setRooms(list))
        .catch(() => {})
    load()
    const id = setInterval(load, 5000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])

  const saveName = (n) => {
    setName(n)
    localStorage.setItem('poker:name', n)
  }

  const submitCreate = (e) => {
    e.preventDefault()
    if (!name.trim()) return
    onCreate(name.trim(), {
      startingChips: Number(chips) || undefined,
      smallBlind: Number(smallBlind) || undefined,
      bigBlind: Number(bigBlind) || undefined,
      rebuys: Number(rebuys) || 0,
      lang,
      aiChat,
      icon,
    })
  }
  const submitJoin = (e) => {
    e.preventDefault()
    if (!name.trim() || !code.trim()) return
    onJoin(name.trim(), code.trim().toUpperCase(), icon)
  }

  return (
    <div className="screen join-screen">
      <div className="join-panel">
        <h1>♠ {casinoName}</h1>
        <p className="tagline">{tagline} · room battles · full side-pot rules</p>

        {notice ? <div className="notice">{notice}</div> : null}

        <div className="platform-auth">
          <div className="settings-title">Casino account</div>
          {me ? (
            <p style={{ margin: '8px 0' }}>
              Signed in as <b>{me.display_name || me.username}</b> · {(me.balance || 0).toLocaleString()} {platform?.coins?.currencyName || 'Gold Coins'}
              {' '}<button type="button" className="btn btn-ghost" style={{ padding: '4px 10px' }} onClick={() => onPlatformAuth('')}>Sign out</button>
            </p>
          ) : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username" maxLength={20} autoComplete="username" />
              <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="password" type="password" autoComplete="current-password" />
              <input value={totpInput} onChange={(e) => setTotpInput(e.target.value)} placeholder="2FA code (if set)" maxLength={6} inputMode="numeric" style={{ width: 130 }} />
              <button type="button" className="btn btn-ghost" onClick={() => doAuth('login')}>Sign in</button>
              <button type="button" className="btn btn-ghost" onClick={() => doAuth('register')}>Register</button>
              {authErr ? <span style={{ color: '#c0392b' }}>{authErr}</span> : null}
            </div>
          )}
        </div>

        <form className="join-form" onSubmit={submitJoin}>
          <label>
            Nickname
            <input
              value={name}
              onChange={(e) => saveName(e.target.value)}
              placeholder="your name"
              maxLength={12}
              autoFocus
            />
          </label>
          <div className="avatar-picker">
            <div className="avatar-picker-title">Avatar</div>
            <div className="avatar-grid">
              {AVATARS.map((a) => (
                <button
                  key={a}
                  type="button"
                  className={'avatar-choice' + (a === icon ? ' selected' : '')}
                  onClick={() => pickIcon(a)}
                >
                  <img src={a} alt="avatar" draggable={false} />
                </button>
              ))}
            </div>
          </div>
          <label>
            Room code
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="e.g. ABCD"
              maxLength={4}
            />
          </label>
          <div className="settings-title">Room settings (for Create Room)</div>
          <div className="room-settings">
            <label>
              Starting chips
              <input type="number" min="10" step="10" value={chips} onChange={(e) => setChips(e.target.value)} />
            </label>
            <label>
              Small blind
              <input type="number" min="1" value={smallBlind} onChange={(e) => setSmallBlind(e.target.value)} />
            </label>
            <label>
              Big blind
              <input type="number" min="2" value={bigBlind} onChange={(e) => setBigBlind(e.target.value)} />
            </label>
            <label>
              Rebuys (0 = none)
              <input type="number" min="0" max="10" value={rebuys} onChange={(e) => setRebuys(e.target.value)} />
            </label>
            <label>
              Chat language
              <select value={lang} onChange={(e) => setLang(e.target.value)}>
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={aiChat} onChange={(e) => setAiChat(e.target.checked)} />
              AI chat banter
            </label>
          </div>
          <div className="join-buttons">
            <button className="btn btn-primary" type="submit" disabled={!name.trim() || !code.trim()}>
              Join Room
            </button>
            <button className="btn btn-ghost" onClick={submitCreate} disabled={!name.trim()} type="button">
              Create Room
            </button>
          </div>
        </form>

        {rooms.length > 0 ? (
          <div className="room-list">
            <div className="room-list-title">Open rooms</div>
            {rooms.map((r) => (
              <button key={r.id} className="room-list-item" onClick={() => onJoin(name.trim() || 'Player', r.id, icon)}>
                <b>{r.id}</b>
                <span>
                  {r.players}/{r.max} players · {r.phase === 'playing' ? 'in game' : 'waiting'}
                </span>
              </button>
            ))}
          </div>
        ) : null}

        {sweepEnabled ? <SweepPanel platform={platform} platformToken={platformToken} /> : null}
        <TwoFactorPanel platformToken={platformToken} me={me} onRefreshMe={refreshMe} />
      </div>
    </div>
  )
}
