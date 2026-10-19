import { useEffect, useState } from 'react'

// Sweepstakes wallet panel. Rendered ONLY when the platform reports
// sweepstakes.enabled (license-unlocked). Shows SC balance, redemption
// requests, and the compliance notice.
export default function SweepPanel({ platform, platformToken }) {
  const sw = platform?.sweepstakes
  const [balance, setBalance] = useState(null)
  const [history, setHistory] = useState([])
  const [showRedeem, setShowRedeem] = useState(false)
  const [amount, setAmount] = useState('')
  const [stateCode, setStateCode] = useState('')
  const [confirm18, setConfirm18] = useState(false)
  const [msg, setMsg] = useState('')

  const auth = { Authorization: 'Bearer ' + platformToken }

  const load = () => {
    if (!platformToken) return
    fetch('/api/sweep/balance', { headers: auth })
      .then((r) => r.json())
      .then((r) => { if (r.ok) setBalance(r.sweepBalance) })
      .catch(() => {})
    fetch('/api/sweep/redemptions', { headers: auth })
      .then((r) => r.json())
      .then((r) => { if (r.ok) setHistory(r.redemptions) })
      .catch(() => {})
  }
  useEffect(load, [platformToken]) // eslint-disable-line react-hooks/exhaustive-deps

  const submitRedeem = async (e) => {
    e.preventDefault()
    setMsg('')
    try {
      const r = await fetch('/api/sweep/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ amount: Number(amount), stateCode, confirm18 }),
      }).then((x) => x.json())
      if (!r.ok) { setMsg('Error: ' + (r.error || 'failed')); return }
      setMsg(`Request #${r.redemptionId} submitted for $${r.usdAmount} — pending review.`)
      setShowRedeem(false)
      setAmount('')
      load()
    } catch {
      setMsg('Network error')
    }
  }

  if (!sw?.enabled) return null

  return (
    <div className="sweep-panel" style={{ marginTop: 16, border: '1px solid #d4af37', borderRadius: 8, padding: 12 }}>
      <div className="settings-title">♠ {sw.currencyName}</div>
      {!platformToken ? (
        <p style={{ color: '#888' }}>Sign in to use {sw.currencyName}.</p>
      ) : (
        <>
          <p>Balance: <b>{balance === null ? '…' : balance.toLocaleString()}</b> {sw.shortName}</p>
          <button type="button" className="btn btn-primary" onClick={() => setShowRedeem(true)}>
            Redeem for Prizes
          </button>
          {showRedeem ? (
            <form onSubmit={submitRedeem} style={{ marginTop: 10, display: 'grid', gap: 8 }}>
              <label>Amount ({sw.shortName}, min {sw.minRedeem})
                <input type="number" min={sw.minRedeem} value={amount} onChange={(e) => setAmount(e.target.value)} required />
              </label>
              <label>State code
                <input value={stateCode} onChange={(e) => setStateCode(e.target.value.toUpperCase())} placeholder="e.g. TX" maxLength={2} required />
              </label>
              <label className="checkbox-label">
                <input type="checkbox" checked={confirm18} onChange={(e) => setConfirm18(e.target.checked)} required />
                I confirm I am {sw.minAge}+ and eligible
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="submit" className="btn btn-primary">Submit Request</button>
                <button type="button" className="btn btn-ghost" onClick={() => setShowRedeem(false)}>Cancel</button>
              </div>
            </form>
          ) : null}
          {msg ? <p style={{ marginTop: 8 }}>{msg}</p> : null}
          {history.length > 0 ? (
            <div style={{ marginTop: 10 }}>
              <div className="settings-title">Redemption history</div>
              {history.map((h) => (
                <div key={h.id} style={{ fontSize: '0.85em', color: '#aaa' }}>
                  #{h.id} · {h.sweep_amount} {sw.shortName} → ${h.usd_amount} · {h.status}
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}
      <p style={{ fontSize: '0.75em', color: '#888', marginTop: 10 }}>{sw.notice}</p>
    </div>
  )
}
