'use strict';
// Anti-collusion basics.
//
// What this does TODAY (working):
//   - Tracks the IP address of every seated player, per table.
//   - Flags the table when 2+ distinct players share one IP
//     (same household/VPN — legitimate sometimes, collusion sometimes).
//   - Flags when one IP holds 3+ seats at the same table (high risk).
//   - All flags land in the collusion_flags table for admin review.
//
// What this does NOT yet do (documented stub):
//   - Behavioral pattern detection (chip dumping, soft play, showdown
//     avoidance). The recordShowdown()/analyze() API below is the
//     integration point; heuristics plug in here.

const { stmts } = require('./db');

// in-memory: tableId -> Map(ip -> Set(playerLabel))
const tables = new Map();

function normIp(ip) {
  return String(ip || '').replace(/^::ffff:/, '').trim() || 'unknown';
}

function tableIps(tableId) {
  if (!tables.has(tableId)) tables.set(tableId, new Map());
  return tables.get(tableId);
}

function flag(tableId, kind, detail) {
  try {
    stmts.addCollusionFlag.run(tableId, kind, detail);
  } catch {}
  console.log(`[collusion] ${kind} @ ${tableId}: ${detail}`);
}

/**
 * Record a player joining a table. Returns an array of new flag kinds (if any).
 */
function noteJoin(tableId, ip, playerLabel) {
  ip = normIp(ip);
  const ips = tableIps(tableId);
  if (!ips.has(ip)) ips.set(ip, new Set());
  ips.get(ip).add(playerLabel);
  const count = ips.get(ip).size;
  const kinds = [];
  if (count === 2) {
    kinds.push('same-ip-pair');
    flag(tableId, 'same-ip-pair', `Two players share IP ${ip}: ${[...ips.get(ip)].join(', ')}`);
  } else if (count === 3) {
    kinds.push('same-ip-multi');
    flag(tableId, 'same-ip-multi', `THREE+ players share IP ${ip}: ${[...ips.get(ip)].join(', ')} — review promptly`);
  }
  return kinds;
}

function noteLeave(tableId, ip, playerLabel) {
  ip = normIp(ip);
  const ips = tables.get(tableId);
  if (!ips || !ips.has(ip)) return;
  ips.get(ip).delete(playerLabel);
  if (ips.get(ip).size === 0) ips.delete(ip);
}

// ---- pattern-detection stub --------------------------------------------------
// Record which IPs reached a showdown together. analyze() turns recent
// history into heuristic scores. Wire recordShowdown() into the engine's
// hand-end path when behavioral detection is built out.
const showdowns = new Map(); // tableId -> [{ips:[...], at}]

function recordShowdown(tableId, ips) {
  if (!showdowns.has(tableId)) showdowns.set(tableId, []);
  const list = showdowns.get(tableId);
  list.push({ ips: ips.map(normIp), at: Date.now() });
  if (list.length > 200) list.splice(0, list.length - 200);
}

/**
 * Heuristic analysis (stub v0): for each IP pair, what fraction of recent
 * showdowns included both? Pairs above 60% get flagged for review.
 * This is a starting point, not a verdict — human review required.
 */
function analyze(tableId) {
  const list = showdowns.get(tableId) || [];
  const pairCounts = new Map();
  for (const s of list) {
    const uniq = [...new Set(s.ips)];
    for (let i = 0; i < uniq.length; i++) {
      for (let j = i + 1; j < uniq.length; j++) {
        const k = [uniq[i], uniq[j]].sort().join('|');
        pairCounts.set(k, (pairCounts.get(k) || 0) + 1);
      }
    }
  }
  const findings = [];
  for (const [pair, n] of pairCounts) {
    const frac = list.length ? n / list.length : 0;
    if (list.length >= 10 && frac >= 0.6) {
      findings.push({ pair: pair.split('|'), showdownsTogether: n, ofRecent: list.length, frac: Math.round(frac * 100) / 100, note: 'same pair in 60%+ of recent showdowns — review' });
    }
  }
  return { tableId, recentShowdowns: list.length, findings };
}

module.exports = { noteJoin, noteLeave, recordShowdown, analyze, normIp };
