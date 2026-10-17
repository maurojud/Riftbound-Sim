import { useState } from 'react'
import { supabase, configured } from './supabase'

export default function Auth() {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setMsg('')
    const { error, data } =
      mode === 'login'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password, options: { data: { username } } })
    setBusy(false)
    if (error) setMsg(error.message)
    else if (mode === 'signup' && !data.session) setMsg('Konto erstellt. Bestätige die E-Mail und melde dich dann an.')
  }

  return (
    <div className="auth">
      <h1>Riftbound Table</h1>
      <p className="muted">Spiele vor Ort am Fernseher, mit Handkarten auf dem Tablet.</p>
      {!configured && <p className="error">Supabase ist nicht konfiguriert. Lege eine .env mit VITE_SUPABASE_URL und VITE_SUPABASE_ANON_KEY an.</p>}
      <form onSubmit={submit} className="stack">
        {mode === 'signup' && (
          <input placeholder="Spielername" value={username} onChange={(e) => setUsername(e.target.value)} required />
        )}
        <input type="email" placeholder="E-Mail" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input type="password" placeholder="Passwort" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
        <button className="primary" disabled={busy}>{mode === 'login' ? 'Anmelden' : 'Konto erstellen'}</button>
      </form>
      {msg && <p className="error">{msg}</p>}
      <button className="link" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>
        {mode === 'login' ? 'Noch kein Konto? Registrieren' : 'Schon ein Konto? Anmelden'}
      </button>
    </div>
  )
}
