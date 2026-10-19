import { useEffect, useState } from 'react'

// Player-facing 2FA management. Shown on the join screen when signed in.
export default function TwoFactorPanel({ platformToken, me, onRefreshMe }) {
  const [secret, setSecret] = useState('')
  const [code, setCode] = useState('')
  const [msg, setMsg] = useState('')
  const [pw, setPw] = useState('')

  if (!platformToken || !me) return null
  const auth = { Authorization: 'Bearer ' + platformToken }

  const setup = async () => {
    setMsg('')
    const r = await fetch('/api/2fa/setup', { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth }, body: '{}' }).then((x) => x.json())
    if (r.ok) setSecret(r.secret)
    else setMsg('Setup failed')
  }
  const confirm = async () => {
    const r = await fetch('/api/2fa/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify({ token: code }) }).then((x) => x.json())
    if (r.ok) { setMsg('2FA enabled.'); setSecret(''); setCode(''); onRefreshMe && onRefreshMe() }
    else setMsg('Wrong code — try again.')
  }
  const disable = async () => {
    const r = await fetch('/api/2fa/disable', { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify({ password: pw }) }).then((x) => x.json())
    if (r.ok) { setMsg('2FA disabled.'); setPw(''); onRefreshMe && onRefreshMe() }
    else setMsg('Failed: ' + (r.error || 'error'))
  }

  return (
    <div style={{ marginTop: 12, border: '1px solid #333', borderRadius: 8, padding: 12 }}>
      <div className="settings-title">Two-factor authentication</div>
      {me.totp_enabled ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ color: '#2ecc71' }}>2FA is ON</span>
          <input value={pw} onChange={(e) => setPw(e.target.value)} type="password" placeholder="password to disable" />
          <button type="button" className="btn btn-ghost" onClick={disable}>Disable</button>
        </div>
      ) : secret ? (
        <div>
          <p style={{ fontSize: '0.85em', color: '#888' }}>Type this into your authenticator app, then enter the 6-digit code:</p>
          <p style={{ fontFamily: 'monospace', fontSize: '1.1em', letterSpacing: 2 }}>{secret.match(/.{1,4}/g).join(' ')}</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="6-digit code" maxLength={6} inputMode="numeric" style={{ width: 130 }} />
            <button type="button" className="btn btn-primary" onClick={confirm}>Confirm</button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn btn-ghost" onClick={setup}>Set up 2FA</button>
      )}
      {msg ? <p style={{ marginTop: 8 }}>{msg}</p> : null}
    </div>
  )
}
