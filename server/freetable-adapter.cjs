'use strict';
// Free-table game server adapter — mounts the blue/purple 5-player tables
// (texas-hold-em-platform) into the platform on a SINGLE port.
//
// The game Socket.IO lives at path /ft/socket.io and its REST API at /ft/api/*
// so nothing collides with the platform's own /api/* and /socket.io.
//
// Platform auth: clients may pass `session` (platform login token) with
// room:create / room:join. When valid, the seat uses the account's
// display name + avatar, and the account id is attached for future
// balance/sweepstakes hooks.

const { Server } = require('socket.io');
const collusion = require('./collusion');

async function attachFreeTable({ httpServer, app, verify, stmts }) {
  const { createRoom, getRoom, rooms } = await import('./freetable/room.js');
  const { CONFIG } = await import('./freetable/config.js');

  const io = new Server(httpServer, { path: '/ft/socket.io', cors: { origin: '*' } });

  // REST: room list + health (namespaced to avoid /api/* collisions)
  app.get('/ft/api/rooms', (_req, res) => {
    res.json(
      [...rooms.values()].map((r) => ({
        id: r.id,
        phase: r.phase,
        players: r.seats.filter(Boolean).length,
        online: r.sockets.size,
        max: CONFIG.MAX_PLAYERS,
      }))
    );
  });
  app.get('/ft/api/health', (_req, res) => res.json({ ok: true, game: 'freetable' }));

  function resolveAccount(msg) {
    try {
      if (msg && msg.session) {
        const payload = verify(msg.session);
        if (payload) {
          const p = stmts.getById.get(payload.id);
          if (p && !p.banned) return p;
        }
      }
    } catch {}
    return null;
  }

  // platform avatar ids look like "player-03" — the client maps them to images
  const avatarIcon = (acct, fallback) => (acct && acct.avatar ? acct.avatar : fallback);

  io.on('connection', (socket) => {
    let room = null;
    let ftIp = null;
    let ftLabel = null;
    const me = () => (room ? room.sockets.get(socket.id) ?? null : null);
    const needRoom = (cb) => {
      if (!room) { cb({ ok: false, error: 'Join a room first' }); return null; }
      return room;
    };

    const trackJoin = (roomId, displayName) => {
      ftIp = socket.handshake.address;
      ftLabel = displayName || socket.id.slice(0, 8);
      collusion.noteJoin('ft:' + roomId, ftIp, ftLabel);
    };
    const trackLeave = () => {
      if (room) collusion.noteLeave('ft:' + room.id, ftIp, ftLabel);
    };

    socket.on('room:create', ({ name, session, startingChips, smallBlind, bigBlind, rebuys, lang, aiChat, icon } = {}, cb = () => {}) => {
      const acct = resolveAccount({ session });
      const displayName = acct ? (acct.display_name || acct.username) : name;
      room?.removeSocket(socket.id);
      room = createRoom({ startingChips, smallBlind, bigBlind, rebuys, lang, aiChat });
      room.attach(io);
      const res = room.join({ name: displayName, icon: avatarIcon(acct, icon), socketId: socket.id });
      if (acct && res.ok && !res.spectator) room.accountByPlayer = room.accountByPlayer || new Map(), room.accountByPlayer.set(res.playerId, acct.id);
      if (res.ok) trackJoin(room.id, displayName);
      cb({ ...res, roomId: room.id, accountId: acct ? acct.id : null });
    });

    socket.on('room:join', ({ roomId, name, session, playerId, icon } = {}, cb = () => {}) => {
      const target = getRoom(roomId);
      if (!target) return cb({ ok: false, error: 'Room not found' });
      const acct = resolveAccount({ session });
      const displayName = acct ? (acct.display_name || acct.username) : name;
      room?.removeSocket(socket.id);
      room = target;
      room.attach(io);
      const res = room.join({ name: displayName, playerId, icon: avatarIcon(acct, icon), socketId: socket.id });
      if (acct && res.ok && !res.spectator) room.accountByPlayer = room.accountByPlayer || new Map(), room.accountByPlayer.set(res.playerId, acct.id);
      if (res.ok) trackJoin(target.id, displayName);
      cb({ ...res, roomId: target.id, accountId: acct ? acct.id : null });
    });

    socket.on('room:addBot', (_data, cb = () => {}) => { const r = needRoom(cb); if (r) cb(r.addBot(me())); });
    socket.on('room:kick', ({ targetId } = {}, cb = () => {}) => { const r = needRoom(cb); if (r) cb(r.kick(me(), targetId)); });
    socket.on('game:start', (_data, cb = () => {}) => { const r = needRoom(cb); if (r) cb(r.start(me())); });
    socket.on('game:action', (action, cb = () => {}) => { const r = needRoom(cb); if (r) cb(r.applyAction(me(), action)); });
    socket.on('game:rebuy', (_data, cb = () => {}) => { const r = needRoom(cb); if (r) cb(r.rebuy(me())); });
    socket.on('game:reveal', (data = {}, cb = () => {}) => {
      const r = needRoom(cb); if (!r) return;
      cb(data && data.decline ? r.declineReveal(me()) : r.reveal(me(), data));
    });
    socket.on('room:sit', (_data, cb = () => {}) => { const r = needRoom(cb); if (r) cb(r.sit(socket.id)); });
    socket.on('room:spectate', (_data, cb = () => {}) => {
      const r = needRoom(cb); if (!r) return;
      const pid = r.sockets.get(socket.id);
      if (pid == null) return cb({ ok: false, error: 'You are not seated' });
      cb(r.becomeSpectator(pid, socket.id));
    });
    socket.on('game:return', (_data, cb = () => {}) => {
      const r = needRoom(cb); if (!r) return;
      const pid = r.sockets.get(socket.id);
      if (pid == null) return cb({ ok: false, error: 'You are not seated' });
      cb(r.returnToGame(pid, socket.id));
    });
    socket.on('room:leave', (_data, cb = () => {}) => {
      const r = needRoom(cb); if (!r) return;
      const pid = r.sockets.get(socket.id);
      if (pid == null) return cb({ ok: false, error: 'You are not seated' });
      trackLeave();
      cb(r.leave(pid, socket.id));
    });
    socket.on('chat:send', ({ text } = {}, cb = () => {}) => {
      const r = needRoom(typeof cb === 'function' ? cb : () => {}); if (!r) return;
      const pid = r.sockets.get(socket.id);
      const ack = typeof cb === 'function' ? cb : () => {};
      ack(pid != null ? r.sendChat(pid, text) : r.sendSpectatorChat(socket.id, text));
    });
    socket.on('disconnect', () => { trackLeave(); room?.removeSocket(socket.id); room = null; });
  });

  console.log('Free-table game server attached at /ft (socket path /ft/socket.io)');
  return { io, rooms, CONFIG };
}

module.exports = { attachFreeTable };
