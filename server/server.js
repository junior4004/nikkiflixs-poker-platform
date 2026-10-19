'use strict';
// Nikkiflixs Poker Platform — white-label server.
// Poker engine + player accounts + admin + payments, all in one deployable package.
// Buyer config: ../config/casino.json

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');
const { RoomManager } = require('./roomManager');
const { verify, authMiddleware, adminMiddleware } = require('./auth');
const { stmts, adjustSweepBalance } = require('./db');
const license = require('./license');

const { attachFreeTable } = require('./freetable-adapter.cjs');
const collusion = require('./collusion');

const PROTOCOL_V = 1;
const PORT = process.env.PORT || 3000;

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/casino.json'), 'utf8'));

const app = express();
app.set('trust proxy', 1); // honor X-Forwarded-Proto behind Render/Cloudflare/etc.
app.use(express.json());

// ---- Transport security ------------------------------------------------------
// Behind a TLS-terminating proxy (Render, Cloudflare, nginx), force HTTPS.
// Set FORCE_HTTPS=1 in production. HSTS is only sent over HTTPS responses.
const FORCE_HTTPS = process.env.FORCE_HTTPS === '1' || process.env.NODE_ENV === 'production';
app.use((req, res, next) => {
  const proto = req.get('x-forwarded-proto') || req.protocol;
  if (FORCE_HTTPS && proto !== 'https') {
    return res.redirect(301, 'https://' + req.get('host') + req.originalUrl);
  }
  next();
});
app.use((req, res, next) => {
  const proto = req.get('x-forwarded-proto') || req.protocol;
  if (proto === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, v: PROTOCOL_V, casino: config.casino.name, tables: rooms.listTables(), uptime: process.uptime() });
});

// public + admin APIs
app.use('/api', require('./routes/api'));
app.use('/api/admin', require('./routes/admin'));

// serve admin panel
app.use('/admin', express.static(path.join(__dirname, '../admin'), { etag: false, maxAge: 0 }));
// public security & fair-play page (white-labeled from config)
app.get('/security', (req, res) => {
  try {
    let html = fs.readFileSync(path.join(__dirname, 'public/security.html'), 'utf8');
    html = html.replaceAll('{{CASINO_NAME}}', config.casino.name || 'Poker Platform')
               .replaceAll('{{SUPPORT_EMAIL}}', config.casino.supportEmail || '')
               .replaceAll('{{ACCENT}}', (config.theme && config.theme.accent) || '#d4af37');
    res.type('html').send(html);
  } catch {
    res.status(500).json({ ok: false, error: 'unavailable' });
  }
});
// serve client build (buyer drops their React build here)
app.use(express.static(path.join(__dirname, '../client'), { etag: false, maxAge: 0 }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const rooms = new RoomManager();
app.locals.rooms = rooms;

// ---- Sweepstakes (encrypted module, license-gated) ----
function mountSweepstakes() {
  try {
    const sweepMod = license.loadSweepstakesModule();
    if (!sweepMod) { console.log('Sweepstakes mode: LOCKED (gold coins only)'); return null; }
    const sweep = sweepMod.mount({
      app,
      authMiddleware, adminMiddleware, stmts, adjustSweepBalance,
      getSweepConfig: () => config.sweepstakes,
      auditLicense: (a, d) => license.audit(a, d),
    });
    app.locals.sweep = sweep;
    console.log('Sweepstakes mode: UNLOCKED');
    return sweep;
  } catch (e) {
    console.error('Sweepstakes load failed:', e.message);
    return null;
  }
}
mountSweepstakes();
app.locals.mountSweepstakes = mountSweepstakes;

// ---- Free-table game server (blue/purple 5-player) on the same port ----
attachFreeTable({ httpServer: server, app, verify, stmts })
  .catch(e => console.error('Free-table attach failed:', e.message));

// create tables from config
for (const t of config.tables) {
  if (t.game === 'blackjack') continue; // blackjack engine is Phase 2
  rooms.createTable(t.id, {
    smallBlind: t.smallBlind || 1,
    bigBlind: t.bigBlind || 2,
    maxPlayers: t.maxPlayers || 8,
    startingStack: t.startingStack || 1000,
  });
}

function broadcastState(tableId) {
  const room = rooms.getTable(tableId);
  if (!room) return;
  rooms.eachSocket(room, (token, socketId) => {
    io.to(socketId).emit('room', room.engine.getState(token));
  });
}

function syncTable(tableId) {
  const room = rooms.getTable(tableId);
  if (!room) return;
  const events = room.engine.drainEvents();
  for (const ev of events) {
    if (ev.type === 'turn' && ev.token) {
      const sid = room.sockets.get(ev.token);
      if (sid) io.to(sid).emit('yourTurn', { legal: ev.legal });
    }
    io.to(tableId).emit(ev.type, ev);
  }
  broadcastState(tableId);
  const eng = room.engine;
  if (eng.state === 'waiting' && eng.canStartHand()) {
    setTimeout(() => {
      if (eng.state === 'waiting' && eng.canStartHand()) {
        eng.startHand();
        syncTable(tableId);
      }
    }, 3000);
  }
}

io.on('connection', (socket) => {
  let tableId = null;
  let token = null;
  let accountId = null;
  let playerIp = null;
  let playerLabel = null;

  socket.on('join', (msg = {}) => {
    if (msg.v !== PROTOCOL_V) {
      socket.emit('error', { code: 'stale-client', msg: 'Please refresh — poker client out of date.' });
      return;
    }
    // optional auth: if client sends a session token, link the seat to the account
    if (msg.session) {
      const payload = verify(msg.session);
      if (payload) {
        const player = stmts.getById.get(payload.id);
        if (player && !player.banned) {
          accountId = player.id;
          msg.name = msg.name || player.display_name || player.username;
          // use account balance as buy-in if not specified
          if (!msg.buyIn) msg.buyIn = Math.min(player.balance, 1000);
        } else {
          socket.emit('error', { code: 'auth-failed', msg: 'Session invalid or account banned.' });
          return;
        }
      }
    }
    const room = rooms.getTable(msg.table);
    if (!room) {
      socket.emit('error', { code: 'no-table', msg: 'Unknown table.' });
      return;
    }
    tableId = msg.table;
    token = msg.token || rooms.newToken();
    const isNew = !room.engine.players.has(token);
    if (isNew) {
      const seat = room.engine.addPlayer(token, msg.name || 'Player', msg.buyIn);
      if (seat < 0) {
        socket.emit('error', { code: 'table-full', msg: 'Table is full.' });
        tableId = null; token = null;
        return;
      }
    }
    rooms.attach(tableId, token, socket.id);
    socket.join(tableId);
    // anti-collusion: track IP per table, flag shared IPs
    playerIp = socket.handshake.address;
    playerLabel = msg.name || token.slice(0, 8);
    const newFlags = collusion.noteJoin(tableId, playerIp, playerLabel);
    if (newFlags.length) socket.emit('notice', { code: 'collusion-flag', msg: 'Fair-play review triggered on this table.' });
    socket.emit('joined', { token, table: tableId, accountId });
    socket.emit('room', room.engine.getState(token));
    broadcastState(tableId);
    syncTable(tableId);
  });

  const requireSeat = () => {
    if (!tableId || !token) {
      socket.emit('error', { code: 'not-joined', msg: 'Join a table first.' });
      return null;
    }
    return rooms.getTable(tableId);
  };

  for (const action of ['fold', 'check', 'call']) {
    socket.on(action, () => {
      const r = requireSeat(); if (!r) return;
      const res = r.engine.act(token, action);
      if (!res.ok) socket.emit('error', { code: res.error, msg: 'Action rejected.' });
      syncTable(tableId);
    });
  }
  socket.on('raise', (msg = {}) => {
    const r = requireSeat(); if (!r) return;
    const res = r.engine.act(token, 'raise', msg.amount);
    if (!res.ok) socket.emit('error', { code: res.error, msg: 'Action rejected.', min: res.min });
    syncTable(tableId);
  });
  socket.on('leave', () => {
    const r = tableId && rooms.getTable(tableId);
    if (r) { r.engine.removePlayer(token); rooms.detachBySocket(socket.id); syncTable(tableId); }
    if (tableId) { socket.leave(tableId); collusion.noteLeave(tableId, playerIp, playerLabel); }
    tableId = null; token = null; accountId = null; playerIp = null; playerLabel = null;
  });
  socket.on('disconnect', () => {
    rooms.detachBySocket(socket.id);
    if (tableId) { syncTable(tableId); collusion.noteLeave(tableId, playerIp, playerLabel); }
    tableId = null; token = null; accountId = null; playerIp = null; playerLabel = null;
  });
});

setInterval(() => rooms.sweep(), 30000);

// ---- Global error handling: never leak stacks to clients in production ----
app.use((err, req, res, _next) => {
  console.error('[error]', req.method, req.path, err.message);
  const body = { ok: false, error: 'internal-error' };
  if (process.env.NODE_ENV !== 'production') body.detail = err.message;
  res.status(500).json(body);
});
// 404 for unknown API routes (keeps scanners from fingerprinting)
app.use('/api', (req, res) => res.status(404).json({ ok: false, error: 'not-found' }));

process.on('SIGTERM', () => {
  console.log('SIGTERM — draining...');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 25000).unref();
});

server.listen(PORT, () => {
  console.log(`${config.casino.name} — poker platform v${PROTOCOL_V} on :${PORT}`);
  console.log('Tables:', rooms.listTables().map(t => t.id).join(', '));
});

module.exports = { app, io, rooms, config, PROTOCOL_V };
