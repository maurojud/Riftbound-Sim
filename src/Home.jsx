import { useState } from 'react'
import { supabase } from './supabase'
import { go } from './nav'
import { DEFAULT_SETTINGS } from './game'
import { SETTING_LABELS } from './Session'


export default function Home({ joinCode }) {
  const [password, setPassword] = useState('')
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [playHere, setPlayHere] = useState(false)
  const [code, setCode] = useState(joinCode || '')
  const [jpw, setJpw] = useState('')
  const [role, setRole] = useState('player')
  const [err, setErr] = useState('')

  async function create(e) {
    e.preventDefault()
    setErr('')
    const { data, error } = await supabase.rpc('create_session', { p_password: password, p_settings: settings })
    if (error) return setErr(error.message)
    sessionStorage.setItem('pw:' + data.id, password)
    if (playHere) {
      const r = await supabase.rpc('join_session', { p_code: data.code, p_password: password, p_role: 'player' })
      if (r.error) return setErr(r.error.message)
      go(`/s/${data.id}/play`)
    } else go(`/s/${data.id}/tv`)
  }

  async function join(e) {
    e.preventDefault()
    setErr('')
    const { data, error } = await supabase.rpc('join_session', { p_code: code, p_password: jpw, p_role: role })
    if (error) return setErr(error.message)
    go(`/s/${data}/${role === 'player' ? 'play' : 'watch'}`)
  }

  return (
    <div className="grid2">
      <section className="panel">
        <h2>Session erstellen</h2>
        <p className="muted">Am Fernseher öffnen: zeigt den Tisch. Tablets und Handys treten mit Code und Passwort bei.</p>
        <form onSubmit={create} className="stack">
          <input placeholder="Passwort für die Session" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <fieldset>
            <legend>Was darf der Gegner sehen?</legend>
            {Object.entries(SETTING_LABELS).map(([k, label]) => (
              <label key={k} className="check">
                <input type="checkbox" checked={settings[k]} onChange={(e) => setSettings({ ...settings, [k]: e.target.checked })} />
                {label}
              </label>
            ))}
          </fieldset>
          <label className="check">
            <input type="checkbox" checked={playHere} onChange={(e) => setPlayHere(e.target.checked)} />
            Ich spiele auf diesem Gerät mit (ohne Fernseher)
          </label>
          <button className="primary">{playHere ? 'Erstellen und mitspielen' : 'Erstellen als Fernseher'}</button>
        </form>
      </section>

      <section className="panel">
        <h2>Session beitreten</h2>
        <form onSubmit={join} className="stack">
          <input className="code" placeholder="Code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={5} required />
          <input placeholder="Passwort" value={jpw} onChange={(e) => setJpw(e.target.value)} required />
          <div className="seg">
            <button type="button" className={role === 'player' ? 'on' : ''} onClick={() => setRole('player')}>Mitspielen</button>
            <button type="button" className={role === 'spectator' ? 'on' : ''} onClick={() => setRole('spectator')}>Zuschauen</button>
          </div>
          <button className="primary">Beitreten</button>
        </form>
      </section>
      {err && <p className="error wide">{err}</p>}
    </div>
  )
}
