'use strict';
// Bot backfill for the Nikkiflixs poker platform.
//
// Goal: every table always looks full and alive. Bots fill empty seats and
// play real poker through the engine (same addPlayer/act path as humans).
// When a human joins, one bot quietly leaves between hands. When a human
// leaves, a bot takes the empty seat. Bots act with human-like delays so
// nobody can tell they are bots.
//
// The engine is never modified here — bots only USE its public API:
// addPlayer, removePlayer, act, legalActions, minRaiseTo, maxRaiseTo,
// getState, drainEvents, and the players/state/actingToken fields.

const { randomUUID } = require('crypto');
const { evaluate5, evaluate7 } = require('./engine/evaluator');

// ---------------------------------------------------------------------------
// Identities: realistic human names + the 24-avatar webp set.
// ---------------------------------------------------------------------------

const BOT_NAMES = [
  'Marcus T.', 'Elena R.', 'Deshawn K.', 'Priya S.', 'Jake W.', 'Sofia M.',
  'Terrence B.', 'Aisha J.', 'Cody L.', 'Nadia P.', 'Victor H.', 'Grace C.',
  'Malik D.', 'Hannah F.', 'Omar V.', 'Lily Z.', 'Derek N.', 'Yuki T.',
  'Sam R.', 'Isabel G.', 'Chris P.', 'Fatima A.', 'Leo M.', 'Dana W.',
  'Rico S.', 'Maya T.', 'Ethan B.', 'Zoe K.', 'Andre B.', 'Kim L.',
  'Jordan P.', 'Tara S.', 'Felix N.', 'Rosa M.', 'Kenji W.', 'Alba R.',
  'Dmitri V.', 'Cleo D.', 'Hugo F.', 'Nina B.', 'Owen J.', 'Sade K.',
  'Paul G.', 'Iris H.', 'Theo L.', 'Wren S.', 'Ida M.', 'Cole D.',
];

const AVATARS = Array.from(
  { length: 24 },
  (_, i) => `player-${String(i + 1).padStart(2, '0')}.webp`
);

const CHAT_LINES = [
  'gg', 'nice hand', 'wow', 'haha', 'good luck all', 'lets go',
  'tough one', 'nice catch', 'wp', 'oh man',
];

// ---------------------------------------------------------------------------
// Hand-strength helpers (bot's private reads; Math.random is fine here —
// it only drives personality/timing, never cards or shuffles).
// ---------------------------------------------------------------------------

// Chen formula for preflop hole-card strength (~2..20, AA = 20).
function chen(hole) {
  if (!hole || hole.length < 2) return 0;
  const [c1, c2] = hole;
  const hi = Math.max(c1.rank, c2.rank);
  const lo = Math.min(c1.rank, c2.rank);
  const cardVal = (r) => (r === 12 ? 10 : r === 11 ? 8 : r === 10 ? 7 : r === 9 ? 6 : r / 2);
  let score = cardVal(hi);
  if (hi === lo) score = Math.max(5, score * 2); // pair
  if (c1.suit === c2.suit) score += 2;           // suited
  const gap = hi - lo - 1;
  if (gap === 1) score -= 1;
  else if (gap === 2) score -= 2;
  else if (gap === 3) score -= 4;
  else if (gap >= 4) score -= 5;
  if (gap <= 1 && hi < 10) score += 1;           // straight bonus
  return Math.max(0, score);
}

// Best 5-card made hand from 5-7 cards (flop=5, turn=6, river=7).
function bestMade(cards) {
  if (cards.length === 5) return evaluate5(cards);
  if (cards.length === 7) return evaluate7(cards);
  let best = null; // 6 cards: best 5-card subset
  for (let skip = 0; skip < cards.length; skip++) {
    const five = cards.filter((_, i) => i !== skip);
    const r = evaluate5(five);
    if (!best || r.score > best.score) best = r;
  }
  return best;
}

// Rough draw outs: 4-flush -> 9, 4-straight run -> 8.
function drawOuts(hole, board) {
  const cards = [...hole, ...board];
  let outs = 0;
  const suits = [0, 0, 0, 0];
  for (const c of cards) suits[c.suit]++;
  if (Math.max(...suits) === 4) outs += 9;
  const ranks = [...new Set(cards.map((c) => c.rank))].sort((a, b) => a - b);
  if (ranks.includes(12)) ranks.unshift(-1); // wheel
  let run = 1;
  for (let i = 1; i <= ranks.length; i++) {
    if (i < ranks.length && ranks[i] === ranks[i - 1] + 1) { run++; continue; }
    if (run >= 4) { outs += 8; break; }
    run = 1;
  }
  return Math.min(outs, 15);
}

// True when the bot's pair uses the top board card (top pair-ish).
function hasTopPair(hole, board) {
  if (!board.length) return false;
  const top = Math.max(...board.map((c) => c.rank));
  return hole.some((c) => c.rank === top);
}

// ---------------------------------------------------------------------------
// Bot: one automated player. Tight-aggressive with personality variance.
// ---------------------------------------------------------------------------

class Bot {
  constructor(name, avatar) {
    this.token = randomUUID();
    this.name = name;
    this.avatar = avatar;
    this.thinkScale = 1;
    this.style = {
      aggression: 0.7 + Math.random() * 0.7,  // 0.7..1.4
      looseness: 0.85 + Math.random() * 0.45, // 0.85..1.3
      bluffFreq: 0.03 + Math.random() * 0.05, // 3%..8%
    };
  }

  thinkMs(engine) {
    const me = engine.players.get(this.token);
    const toCall = me ? engine.currentBet - me.betStreet : 0;
    let ms = 800 + Math.random() * 2200;          // 0.8s..3s like a human
    if (toCall > engine.potTotal * 0.5) ms += 1500; // tank on big decisions
    if (engine.board.length >= 4) ms += 600;
    return Math.min(6000, ms) * this.thinkScale;
  }

  decide(engine) {
    const me = engine.players.get(this.token);
    if (!me || !me.hole.length) {
      const legal = engine.legalActions(this.token);
      if (legal.includes('check')) return { action: 'check' };
      return { action: 'fold' };
    }
    const legal = engine.legalActions(this.token);
    if (!legal.length) return null;
    const canRaise = legal.includes('raise');
    const toCall = engine.currentBet - me.betStreet;
    const pot = engine.potTotal;
    const bb = engine.bigBlind;
    const rnd = Math.random;
    const { aggression: A, looseness: L, bluffFreq } = this.style;

    const raiseTo = (target) => {
      if (!canRaise) return toCall === 0 ? { action: 'check' } : { action: 'call' };
      const min = engine.minRaiseTo(this.token);
      const max = engine.maxRaiseTo(this.token);
      let amt = Math.round(Math.min(Math.max(target, min), max) / bb) * bb;
      amt = Math.min(Math.max(amt, min), max);
      return { action: 'raise', amount: amt };
    };

    // ---------------- preflop: Chen formula ----------------
    if (engine.board.length === 0) {
      const s = chen(me.hole) * L;
      if (toCall === 0) {
        if (s >= 9 && rnd() < 0.75 * A) return raiseTo(engine.currentBet + 3 * bb + Math.round(rnd() * 2) * bb);
        return { action: 'check' };
      }
      if (s >= 11) return rnd() < 0.8 && canRaise ? raiseTo(engine.currentBet + 3 * bb) : { action: 'call' };
      if (s >= 8.5) {
        if (toCall <= 4 * bb) return rnd() < 0.25 * A && canRaise ? raiseTo(engine.currentBet + 3 * bb) : { action: 'call' };
        return { action: 'fold' };
      }
      if (s >= 6.5) {
        if (toCall <= 2.5 * bb || toCall <= me.stack * 0.08) return { action: 'call' };
        return { action: 'fold' };
      }
      if (toCall <= bb && s >= 4.5 && rnd() < 0.5) return { action: 'call' }; // cheap speculative
      return { action: 'fold' };
    }

    // ---------------- postflop: made hand + draws ----------------
    const made = bestMade([...me.hole, ...engine.board]);
    const cat = made.category; // 0 high .. 8 straight flush
    const outs = drawOuts(me.hole, engine.board);
    const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;

    if (toCall === 0) {
      if (cat >= 2 && rnd() < 0.8 * A) return raiseTo(pot * (0.5 + rnd() * 0.4));
      if (cat === 1 && rnd() < 0.35 * A) return raiseTo(pot * 0.5);
      if (cat === 0 && rnd() < bluffFreq * A) return raiseTo(pot * 0.6); // occasional bluff
      return { action: 'check' };
    }
    // facing a bet
    if (cat >= 3) return rnd() < 0.85 && canRaise ? raiseTo(engine.currentBet + pot * 0.7) : { action: 'call' };
    if (cat === 2) {
      if (toCall <= pot * 0.6) {
        return rnd() < 0.5 * A && canRaise ? raiseTo(engine.currentBet + pot * 0.6) : { action: 'call' };
      }
      return { action: 'call' };
    }
    if (cat === 1) {
      const limit = hasTopPair(me.hole, engine.board) ? 0.4 : 0.2;
      return toCall <= pot * limit ? { action: 'call' } : { action: 'fold' };
    }
    if (outs >= 8 && potOdds <= outs / 44 + 0.06) return { action: 'call' };
    if (outs >= 4 && potOdds <= outs / 48) return { action: 'call' };
    return { action: 'fold' };
  }
}

// ---------------------------------------------------------------------------
// BotManager: backfill + quiet human/bot swaps, wired to a RoomManager.
// ---------------------------------------------------------------------------

class BotManager {
  constructor(rooms, opts = {}) {
    this.rooms = rooms;
    this.sync = opts.sync || (() => {});
    this.thinkScale = opts.thinkScale ?? 1; // <1 speeds up bots (tests)
    this.chatty = opts.chatty ?? true;
    this.bots = new Map();       // tableId -> Map(token -> Bot)
    this.pending = new Map();    // token -> timeout id (bot is "thinking")
    this.markedLeave = new Map(); // tableId -> Set(token) leaving between hands
    this.bootFilled = new Set();  // tableId already did its instant initial fill
  }

  tableBots(tableId) {
    if (!this.bots.get(tableId)) this.bots.set(tableId, new Map());
    return this.bots.get(tableId);
  }

  isBot(tableId, token) {
    return this.tableBots(tableId).has(token);
  }

  // Avatar filename for a seat name (undefined for humans). The server
  // attaches this to the broadcast state so clients can show bot avatars.
  avatarForName(tableId, name) {
    for (const b of this.tableBots(tableId).values()) {
      if (b.name === name) return b.avatar;
    }
    return undefined;
  }

  pickName(tableId) {
    const room = this.rooms.getTable(tableId);
    const used = new Set();
    if (room) for (const p of room.engine.players.values()) used.add(p.name);
    const pool = BOT_NAMES.filter((n) => !used.has(n));
    const src = pool.length ? pool : BOT_NAMES;
    return src[Math.floor(Math.random() * src.length)];
  }

  pickAvatar(tableId) {
    const used = new Set([...this.tableBots(tableId).values()].map((b) => b.avatar));
    const free = AVATARS.filter((a) => !used.has(a));
    const pool = free.length ? free : AVATARS;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // Seat a bot. Only between hands (joining mid-hand would leave the bot
  // cardless until the next deal). Returns the Bot or null.
  addBot(tableId) {
    const room = this.rooms.getTable(tableId);
    if (!room || room.engine.state !== 'waiting') return null;
    const bot = new Bot(this.pickName(tableId), this.pickAvatar(tableId));
    bot.thinkScale = this.thinkScale;
    const seat = room.engine.addPlayer(bot.token, bot.name, room.engine.startingStack);
    if (seat < 0) return null;
    this.tableBots(tableId).set(bot.token, bot);
    return bot;
  }

  removeBot(tableId, token) {
    const bots = this.tableBots(tableId);
    if (!bots.has(token)) return;
    if (this.pending.has(token)) {
      clearTimeout(this.pending.get(token));
      this.pending.delete(token);
    }
    bots.delete(token);
    const room = this.rooms.getTable(tableId);
    if (room) room.engine.removePlayer(token);
  }

  // Called from the server's event pump when a 'turn' event is drained.
  onTurn(tableId, token) {
    if (!this.isBot(tableId, token)) return;
    if (this.pending.has(token)) return; // already thinking
    const room = this.rooms.getTable(tableId);
    if (!room) return;
    const bot = this.tableBots(tableId).get(token);
    if (!bot) return;
    const ms = Math.max(1, Math.round(bot.thinkMs(room.engine)));
    const tid = setTimeout(() => {
      this.pending.delete(token);
      const r = this.rooms.getTable(tableId);
      if (!r || r.engine.actingToken !== token) return; // turn moved on
      const b = this.tableBots(tableId).get(token);
      if (!b) return; // bot left while thinking
      const decision = b.decide(r.engine);
      if (!decision) return;
      let res = r.engine.act(token, decision.action, decision.amount);
      if (!res.ok) {
        // Fallback chain: never leave the game stuck on a bot.
        const legalNow = r.engine.legalActions(token);
        const fb = legalNow.includes('check') ? 'check'
          : legalNow.includes('call') ? 'call'
          : legalNow.includes('fold') ? 'fold' : null;
        if (fb) res = r.engine.act(token, fb);
      }
      if (res.ok && this.chatty && Math.random() < 0.02) {
        const humans = [...r.engine.players.values()].some((p) => !this.isBot(tableId, p.token));
        if (humans) r.engine.emit('chat', { name: b.name, text: CHAT_LINES[Math.floor(Math.random() * CHAT_LINES.length)] });
      }
      this.sync(tableId);
    }, ms);
    this.pending.set(token, tid);
  }

  // A human took a seat. If the table is full, one bot quietly leaves —
  // immediately between hands, or marked to leave when the hand ends.
  onHumanJoin(tableId) {
    const room = this.rooms.getTable(tableId);
    if (!room) return;
    if (room.engine.players.size < room.engine.maxPlayers) return; // room to spare
    const keys = [...this.tableBots(tableId).keys()];
    if (!keys.length) return;
    const token = keys[Math.floor(Math.random() * keys.length)];
    if (room.engine.state === 'waiting') {
      this.removeBot(tableId, token);
      this.sync(tableId);
    } else {
      if (!this.markedLeave.get(tableId)) this.markedLeave.set(tableId, new Set());
      this.markedLeave.get(tableId).add(token);
    }
  }

  // Periodic upkeep (call every ~15s): top up empty seats with bots,
  // rebuy broke bots, and process quiet departures between hands.
  // Joins are capped per cycle so bots never flood in at once.
  maintain() {
    for (const tableId of this.rooms.tables.keys()) {
      const room = this.rooms.getTable(tableId);
      if (!room) continue;
      const eng = room.engine;
      const bots = this.tableBots(tableId);

      // Forget bot records for tokens no longer seated (swept/disconnected).
      for (const token of [...bots.keys()]) {
        if (!eng.players.has(token)) {
          if (this.pending.has(token)) {
            clearTimeout(this.pending.get(token));
            this.pending.delete(token);
          }
          bots.delete(token);
        }
      }

      if (eng.state !== 'waiting') continue; // only reseat between hands

      // Quiet departures first.
      const marked = this.markedLeave.get(tableId);
      if (marked && marked.size) {
        for (const token of marked) this.removeBot(tableId, token);
        marked.clear();
        this.sync(tableId);
      }

      // Broke bots rebuy like a human would.
      for (const token of bots.keys()) {
        const p = eng.players.get(token);
        if (p && p.stack <= 0) {
          p.stack = eng.startingStack;
          p.sittingOut = false;
        }
      }

      // Fill toward target, leaving one seat open so a human can always sit.
      // The very first fill is instant (nobody's watching at boot); refills
      // are capped per cycle so bots never flood in at once.
      const target = Math.max(2, eng.maxPlayers - 1);
      const cap = this.bootFilled.has(tableId) ? 2 : target;
      this.bootFilled.add(tableId);
      let added = 0;
      while (eng.players.size < target && added < cap) {
        if (!this.addBot(tableId)) break;
        added++;
      }
      if (added) this.sync(tableId);
    }
  }
}

module.exports = { Bot, BotManager, BOT_NAMES, AVATARS, chen, drawOuts };
