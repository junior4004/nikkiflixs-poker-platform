import { useCallback, useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import JoinScreen from './components/JoinScreen.jsx'
import RoomLobby from './components/RoomLobby.jsx'
import GameTable from './components/GameTable.jsx'
import VictoryScreen from './components/VictoryScreen.jsx'
import { syncClock } from './lib.js'

const SESSION_KEY = 'poker:session'
const THEME_KEY = 'nf-theme'
const PLATFORM_TOKEN_KEY = 'nf:platform_token'

function loadTheme() {
  try {
    const t = localStorage.getItem(THEME_KEY)
    return t === 'purple' ? 'purple' : 'blue'
  } catch {
    return 'blue'
  }
}

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null')
  } catch {
    return null
  }
}

export const socket = io({ path: '/ft/socket.io', autoConnect: false })

// Platform token = server-side account session (replaces anonymous localStorage identity)
function loadPlatformToken() {
  try {
    return localStorage.getItem(PLATFORM_TOKEN_KEY) || ''
  } catch {
    return ''
  }
}

export default function App() {
  const [session, setSession] = useState(loadSession)
  const [state, setState] = useState(null)
  const [connected, setConnected] = useState(false)
  const [notice, setNotice] = useState('')
  // Id of the victory screen the player has already dismissed (per-game, so a
  // new game's settlement shows again)
  const [dismissedOverId, setDismissedOverId] = useState(null)
  const [theme, setTheme] = useState(loadTheme)
  const [platformToken, setPlatformToken] = useState(loadPlatformToken)
  const [platformConfig, setPlatformConfig] = useState(null)

  const platformTokenRef = useRef(platformToken)
  platformTokenRef.current = platformToken

  const setPlatformAuth = useCallback((token) => {
    try {
      if (token) localStorage.setItem(PLATFORM_TOKEN_KEY, token)
      else localStorage.removeItem(PLATFORM_TOKEN_KEY)
    } catch {}
    setPlatformToken(token || '')
  }, [])

  // White-label config: casino name, theme colors, sweepstakes status
  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then((cfg) => {
        if (!cfg.ok) return
        setPlatformConfig(cfg)
        document.title = cfg.casino.name
        const root = document.documentElement
        if (cfg.theme?.primary) root.style.setProperty('--platform-primary', cfg.theme.primary)
        if (cfg.theme?.accent) root.style.setProperty('--platform-accent', cfg.theme.accent)
      })
      .catch(() => {})
  }, [])

  const sessionRef = useRef(session)
  sessionRef.current = session

  const clearSession = useCallback((msg) => {
    localStorage.removeItem(SESSION_KEY)
    setSession(null)
    setState(null)
    if (msg) setNotice(msg)
  }, [])

  // Felt theme: blue / purple (persisted)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch {}
  }, [theme])

  // Auto-dismiss the notice bar
  useEffect(() => {
    if (!notice) return
    const id = setTimeout(() => setNotice(''), 4000)
    return () => clearTimeout(id)
  }, [notice])

  // Socket lifecycle: connect / reconnect / state sync
  useEffect(() => {
    socket.on('connect', () => {
      setConnected(true)
      const s = sessionRef.current
      if (s) {
        socket.emit('room:join', { roomId: s.roomId, playerId: s.playerId, name: s.name }, (res) => {
          if (!res?.ok) clearSession(res?.error || 'Room no longer exists')
        })
      }
    })
    socket.on('disconnect', () => setConnected(false))
    socket.on('state', (s) => {
      syncClock(s?.room?.serverTime)
      setState(s)
    })
    socket.on('room:closed', ({ reason } = {}) => clearSession(reason || 'Room closed'))
    socket.on('room:kicked', ({ reason } = {}) => clearSession(reason || 'You were removed from the room'))
    socket.on('room:left', ({ reason } = {}) => clearSession(reason || 'You left the game'))
    if (sessionRef.current) socket.connect()
    return () => {
      socket.off()
    }
  }, [clearSession])

  const establish = useCallback((res, name) => {
    if (!res?.ok) {
      setNotice(res?.error || 'Something went wrong')
      return
    }
    const s = { roomId: res.roomId, playerId: res.playerId, name }
    localStorage.setItem(SESSION_KEY, JSON.stringify(s))
    setSession(s)
    setNotice('')
  }, [])

  const createRoom = useCallback(
    (name, config) => {
      socket.connect()
      socket.emit('room:create', { name, ...config, session: platformTokenRef.current || undefined }, (res) => establish(res, name))
    },
    [establish]
  )

  const joinRoom = useCallback(
    (name, roomId, icon) => {
      socket.connect()
      socket.emit('room:join', { roomId, name, icon, session: platformTokenRef.current || undefined }, (res) => establish({ ...res, roomId: res?.ok ? roomId : undefined }, name))
    },
    [establish]
  )

  const act = useCallback((action) => {
    socket.emit('game:action', action, (res) => {
      if (res && !res.ok) setNotice(res.error)
    })
  }, [])

  const startGame = useCallback(() => {
    socket.emit('game:start', {}, (res) => {
      if (res && !res.ok) setNotice(res.error)
    })
  }, [])

  const addBot = useCallback(() => {
    socket.emit('room:addBot', {}, (res) => {
      if (res && !res.ok) setNotice(res.error)
    })
  }, [])

  const kick = useCallback((targetId) => {
    socket.emit('room:kick', { targetId }, (res) => {
      if (res && !res.ok) setNotice(res.error)
    })
  }, [])

  const rebuy = useCallback(() => {
    socket.emit('game:rebuy', {}, (res) => {
      if (res && !res.ok) {
        setNotice(res.error)
      } else if (res && res.remaining === 0) {
        setNotice('Last rebuy — you are eliminated if you bust again')
      }
    })
  }, [])

  // cards: array of hole-card indices to show (e.g. [0], [1], [0, 1])
  const reveal = useCallback((cards) => {
    socket.emit('game:reveal', { cards }, (res) => {
      if (res && !res.ok) setNotice(res.error)
    })
  }, [])

  const declineReveal = useCallback(() => {
    socket.emit('game:reveal', { decline: true }, (res) => {
      if (res && !res.ok) setNotice(res.error)
    })
  }, [])

  const sendChat = useCallback((text) => {
    socket.emit('chat:send', { text }, (res) => {
      if (res && !res.ok) setNotice(res.error)
    })
  }, [])

  const sit = useCallback(() => {
    socket.emit('room:sit', {}, (res) => {
      if (res && !res.ok) setNotice(res.error)
    })
  }, [])

  const returnToGame = useCallback(() => {
    socket.emit('game:return', {}, (res) => {
      if (res && !res.ok) setNotice(res.error)
    })
  }, [])

  const spectate = useCallback(() => {
    socket.emit('room:spectate', {}, (res) => {
      if (res && !res.ok) setNotice(res.error)
    })
  }, [])

  const leave = useCallback(() => {
    socket.emit('room:leave', {}, (res) => {
      if (res && !res.ok) setNotice(res.error)
    })
  }, [])

  // ==== Rendering ====

  if (!session) {
    return (
      <JoinScreen
        notice={notice}
        onCreate={createRoom}
        onJoin={joinRoom}
        platform={platformConfig}
        platformToken={platformToken}
        onPlatformAuth={setPlatformAuth}
      />
    )
  }

  if (!state) {
    return (
      <div className="screen center-screen">
        {notice ? <div className="notice">{notice}</div> : null}
        <div className="loading">{connected ? 'Entering room…' : 'Connecting to server…'}</div>
      </div>
    )
  }

  const inGame = state.room.phase === 'playing' && state.game
  const gameOver = state.room.gameOver ?? null
  const showVictory = gameOver && gameOver.id !== dismissedOverId

  return (
    <>
      {inGame ? (
        <GameTable
          state={state}
          onAction={act}
          onRebuy={rebuy}
          onReveal={reveal}
          onDeclineReveal={declineReveal}
          onChat={sendChat}
          onLeave={leave}
         theme={theme} onTheme={setTheme} />
      ) : (
        <RoomLobby state={state} onStart={startGame} onAddBot={addBot} onRebuy={rebuy} onKick={kick} onChat={sendChat} onLeave={leave} onSpectate={spectate} />
      )}
      {showVictory ? (
        <VictoryScreen
          gameOver={gameOver}
          youId={state.room.youId}
          onDismiss={() => setDismissedOverId(gameOver.id)}
        />
      ) : null}
      {state.room.youSpectating ? (
        <div className="spectator-bar">
          <span>👀 Spectating</span>
          {state.room.openSeats > 0 ? (
            <button className="btn btn-primary" onClick={sit}>
              Join game ({state.room.openSeats} seat{state.room.openSeats === 1 ? '' : 's'} open)
            </button>
          ) : (
            <span className="action-hint">Room is full — waiting for a seat...</span>
          )}
        </div>
      ) : state.game?.you?.afk ? (
        <div className="spectator-bar">
          <span>🤖 AFK — you've been away</span>
          <button className="btn btn-primary" onClick={returnToGame}>
            Back to game
          </button>
        </div>
      ) : null}
      {notice ? <div className="toast">{notice}</div> : null}
      {!connected ? (
        <div className="overlay">
          <div className="overlay-box">⚠️ Connection lost, reconnecting…</div>
        </div>
      ) : null}
    </>
  )
}
