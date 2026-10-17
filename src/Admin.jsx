import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { KINDS, COLORS } from './game'

export default function Admin({ user }) {
  const [cards, setCards] = useState([])
  const [kind, setKind] = useState('Unit')
  const [color, setColor] = useState('')
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

  async function upload(files) {
    setBusy(true)
    setMsg('')
    let ok = 0
    for (const f of files) {
      const ext = f.name.split('.').pop().toLowerCase()
      const path = `${crypto.randomUUID()}.${ext}`
      const up = await supabase.storage.from('cards').upload(path, f, { contentType: f.type })
      if (up.error) { setMsg(up.error.message); continue }
      const { data } = supabase.storage.from('cards').getPublicUrl(path)
      const ins = await supabase.from('cards').insert({
        name: f.name.replace(/\.[^.]+$/, ''), kind, color: color || null, image_url: data.publicUrl, image_path: path,
      })
      if (ins.error) setMsg(ins.error.message); else ok++
    }
    setBusy(false)
    setMsg(`${ok} von ${files.length} Karten hochgeladen.`)
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
        <p className="muted">Mehrere Bilder auf einmal wählen. Der Dateiname wird zum Kartennamen und lässt sich danach ändern.</p>
        <div className="row">
          <label>Art für diesen Upload
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {KINDS.map((k) => <option key={k}>{k}</option>)}
            </select>
          </label>
          <label>Farbe (bei Runen wichtig)
            <select value={color} onChange={(e) => setColor(e.target.value)}>
              <option value="">keine</option>
              {COLORS.map((k) => <option key={k}>{k}</option>)}
            </select>
          </label>
          <input type="file" accept="image/*" multiple disabled={busy} onChange={(e) => upload([...e.target.files])} />
        </div>
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
