import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { KINDS, COLORS, parseCardFilename } from './game'

export default function Admin({ user }) {
  const [cards, setCards] = useState([])
  const [kind, setKind] = useState('Unit')
  const [color, setColor] = useState('')
  const [queue, setQueue] = useState([])
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState('')

  const load = async () => {
    const { data } = await supabase.from('cards').select('*').order('created_at', { ascending: false })
    setCards(data || [])
  }
  useEffect(() => { load() }, [])

  if (!user.isAdmin) {
    return (
      <div className="panel">
        <h2>Kein Zugriff</h2>
        <p>Dieses Konto ist kein Master. Setze es im Supabase SQL Editor:</p>
        <pre>{`update public.profiles set is_admin = true\nwhere id = (select id from auth.users where email = 'deine@mail.ch');`}</pre>
      </div>
    )
  }

  const exists = (r) =>
    cards.some((c) => c.name.toLowerCase() === r.name.toLowerCase() && c.kind === r.kind && (c.color || '') === (r.color || ''))
  const rows = queue.map((r) => ({ ...r, dup: exists(r) }))
  const todo = rows.filter((r) => !r.dup)

  function choose(files) {
    setMsg('')
    setQueue([...files].map((file) => ({ file, ...parseCardFilename(file.name, { kind, color }) })))
  }

  async function upload() {
    setBusy(true)
    setMsg('')
    let ok = 0
    for (const r of todo) {
      const ext = r.file.name.split('.').pop().toLowerCase()
      const path = `${crypto.randomUUID()}.${ext}`
      const up = await supabase.storage.from('cards').upload(path, r.file, { contentType: r.file.type })
      if (up.error) { setMsg(up.error.message); continue }
      const { data } = supabase.storage.from('cards').getPublicUrl(path)
      const ins = await supabase.from('cards').insert({
        name: r.name, kind: r.kind, color: r.color || null, image_url: data.publicUrl, image_path: path,
      })
      if (ins.error) setMsg(ins.error.message); else ok++
    }
    setBusy(false)
    setQueue([])
    setMsg(`${ok} von ${todo.length} Karten hochgeladen.`)
    load()
  }

  const patch = async (id, values) => { await supabase.from('cards').update(values).eq('id', id); load() }
  async function remove(c) {
    if (!confirm(`„${c.name}“ löschen?`)) return
    if (c.image_path) await supabase.storage.from('cards').remove([c.image_path])
    await supabase.from('cards').delete().eq('id', c.id)
    load()
  }

  const shown = cards.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()))

  return (
    <div className="stack">
      <section className="panel">
        <h2>Karten hochladen</h2>
        <p className="muted">
          Name, Art und Farbe werden aus dem Dateinamen gelesen. Aufbau: <code>name_art_farbe_rest.webp</code>, zum Beispiel{' '}
          <code>riven_unit_calm_3m-4p.webp</code> oder <code>jinx-loose-cannon_champion_chaos.png</code>. Art und Farbe können in
          beliebiger Reihenfolge stehen, alles danach wird ignoriert. Fehlt etwas, gelten die Standardwerte hier:
        </p>
        <div className="row">
          <label>Standard-Art
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {KINDS.map((k) => <option key={k}>{k}</option>)}
            </select>
          </label>
          <label>Standard-Farbe
            <select value={color} onChange={(e) => setColor(e.target.value)}>
              <option value="">keine</option>
              {COLORS.map((k) => <option key={k}>{k}</option>)}
            </select>
          </label>
          <input type="file" accept="image/*" multiple disabled={busy}
            onChange={(e) => { choose(e.target.files); e.target.value = '' }} />
        </div>

        {rows.length > 0 && (
          <>
            <table className="preview">
              <thead><tr><th>Datei</th><th>Name</th><th>Art</th><th>Farbe</th><th>Status</th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className={r.dup ? 'skip' : ''}>
                    <td className="muted">{r.file.name}</td>
                    <td>{r.name}</td>
                    <td className={r.fromName.kind ? '' : 'muted'}>{r.kind}</td>
                    <td className={r.fromName.color ? '' : 'muted'}>{r.color || '–'}</td>
                    <td>
                      {r.dup ? 'schon vorhanden, wird übersprungen'
                        : r.kind === 'Rune' && !r.color ? <span className="warn">Rune ohne Farbe</span>
                        : 'bereit'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="row">
              <button className="primary" disabled={busy || !todo.length} onClick={upload}>
                {busy ? 'Lädt hoch…' : `${todo.length} Karten hochladen`}
              </button>
              <button disabled={busy} onClick={() => setQueue([])}>Abbrechen</button>
            </div>
          </>
        )}
        {msg && <p className="muted">{msg}</p>}
      </section>

      <section className="panel">
        <div className="row">
          <h2>{cards.length} Karten</h2>
          <input placeholder="Suchen" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="admin-grid">
          {shown.map((c) => (
            <div key={c.id} className="admin-card">
              <img src={c.image_url} alt={c.name} loading="lazy" />
              <input defaultValue={c.name} onBlur={(e) => e.target.value !== c.name && patch(c.id, { name: e.target.value })} />
              <select value={c.kind} onChange={(e) => patch(c.id, { kind: e.target.value })}>
                {KINDS.map((k) => <option key={k}>{k}</option>)}
              </select>
              <select value={c.color || ''} onChange={(e) => patch(c.id, { color: e.target.value || null })}>
                <option value="">keine Farbe</option>
                {COLORS.map((k) => <option key={k}>{k}</option>)}
              </select>
              <button className="danger" onClick={() => remove(c)}>Löschen</button>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
