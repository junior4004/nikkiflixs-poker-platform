'use strict';
// SWEEPSTAKES MODULE — encrypted at rest (see tools/build-sweepstakes.js).
// This plaintext is DEV SOURCE ONLY. Never ship it; only sweepstakes.enc ships.
// Loaded in-memory by server/license.js after a valid sweepstakes license.
//
// Model (standard sweepstakes):
//   - Gold Coins: play currency, purchased, no cash value.
//   - Sweepstakes Coins (SC): awarded as a BONUS with gold coin purchases
//     (or free via mail-in / free-play), used in sweepstakes-mode games,
//     redeemable for prizes at the configured rate once playthrough and
//     minimums are met. Operator handles actual prize fulfillment.

function mount(ctx) {
  const { app, authMiddleware, adminMiddleware, stmts, adjustSweepBalance } = ctx;
  const sw = () => ctx.getSweepConfig();

  const compliance = () => ({
    notice: sw().complianceNotice,
    minAge: sw().minAge,
    excludedStates: sw().excludedStates,
  });

  // ---- player endpoints ----
  app.get('/api/sweep/balance', authMiddleware, (req, res) => {
    const row = stmts.getSweepBalance.get(req.player.id);
    res.json({ ok: true, sweepBalance: row ? row.sweep_balance : 0, currencyName: sw().currencyName, ...compliance() });
  });

  app.get('/api/sweep/redemptions', authMiddleware, (req, res) => {
    res.json({ ok: true, redemptions: stmts.myRedemptions.all(req.player.id, 50) });
  });

  // POST /api/sweep/redeem { amount, stateCode, confirm18 }
  app.post('/api/sweep/redeem', authMiddleware, (req, res) => {
    const cfg = sw();
    const amount = Math.floor(Number(req.body.amount));
    const stateCode = String(req.body.stateCode || '').toUpperCase().slice(0, 2);
    if (!req.body.confirm18) return res.status(400).json({ ok: false, error: 'must-confirm-18' });
    if (!Number.isFinite(amount) || amount < cfg.minRedeem)
      return res.status(400).json({ ok: false, error: 'below-minimum', minRedeem: cfg.minRedeem });
    if (cfg.excludedStates.includes(stateCode))
      return res.status(400).json({ ok: false, error: 'state-excluded', stateCode });
    const bal = stmts.getSweepBalance.get(req.player.id);
    if (!bal || bal.sweep_balance < amount)
      return res.status(400).json({ ok: false, error: 'insufficient' });
    const usd = Math.round(amount * cfg.redeemRate * 100) / 100;
    const info = stmts.addRedemption.run(req.player.id, amount, usd, stateCode, 'pending');
    adjustSweepBalance(req.player.id, -amount, 'sweep_redeem_request', `Redemption #${info.lastInsertRowid}: ${amount} SC -> $${usd}`);
    res.json({ ok: true, redemptionId: info.lastInsertRowid, usdAmount: usd, status: 'pending', ...compliance() });
  });

  // ---- admin endpoints ----
  app.get('/api/admin/sweep/redemptions', authMiddleware, adminMiddleware, (req, res) => {
    const status = String(req.query.status || '');
    const limit = Math.min(200, parseInt(req.query.limit) || 50);
    const offset = parseInt(req.query.offset) || 0;
    res.json({ ok: true, redemptions: stmts.listRedemptions.all(status, status, limit, offset) });
  });

  app.post('/api/admin/sweep/redemptions/:id/approve', authMiddleware, adminMiddleware, (req, res) => {
    const r = stmts.getRedemption.get(req.params.id);
    if (!r) return res.status(404).json({ ok: false, error: 'not-found' });
    if (r.status !== 'pending') return res.status(400).json({ ok: false, error: 'not-pending' });
    stmts.setRedemptionStatus.run('approved', req.body.note || 'Approved — fulfill prize offline', r.id);
    ctx.auditLicense('sweep_redeem_approved', `Redemption #${r.id}: ${r.sweep_amount} SC ($${r.usd_amount}) for player ${r.player_id}`);
    res.json({ ok: true });
  });

  app.post('/api/admin/sweep/redemptions/:id/deny', authMiddleware, adminMiddleware, (req, res) => {
    const r = stmts.getRedemption.get(req.params.id);
    if (!r) return res.status(404).json({ ok: false, error: 'not-found' });
    if (r.status !== 'pending') return res.status(400).json({ ok: false, error: 'not-pending' });
    // refund the SC on denial
    adjustSweepBalance(r.player_id, r.sweep_amount, 'sweep_redeem_refund', `Redemption #${r.id} denied — refunded`);
    stmts.setRedemptionStatus.run('denied', req.body.note || 'Denied', r.id);
    ctx.auditLicense('sweep_redeem_denied', `Redemption #${r.id} denied, ${r.sweep_amount} SC refunded`);
    res.json({ ok: true });
  });

  return {
    // called by the payments webhook after a gold-coin purchase
    creditSweepBonus(playerId, packageId) {
      const cfg = sw();
      const bonus = cfg.purchaseBonus && cfg.purchaseBonus[packageId];
      if (!bonus || bonus <= 0) return 0;
      return adjustSweepBalance(playerId, bonus, 'sweep_bonus', `Free bonus: ${bonus} SC with package ${packageId} (no purchase necessary — see terms)`);
    },
    getPublicInfo() {
      const cfg = sw();
      return {
        enabled: true,
        currencyName: cfg.currencyName,
        shortName: cfg.shortName,
        minRedeem: cfg.minRedeem,
        redeemRate: cfg.redeemRate,
        ...compliance(),
      };
    },
  };
}

module.exports = { mount };
