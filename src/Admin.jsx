import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { KINDS, COLORS, parseCardFilename, allowsSecondColor } from './game'
import { parseSetNumber, fetchCardInfo, mapApiCard } from './cardlookup'
import CardImg from './CardImg'

const dbHint = (m) => (/color2|signature|\bcode\b/i.test(m || '') ? 'Datenbank-Update fehlt: bitte supabase/migration-4.sql im SQL Editor ausführen.' : m)

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
    cards.some((c) => (r.code && c.code ? c.code === r.code : c.name.toLowerCase() === r.name.toLowerCase() && c.kind === r.kind && (c.color || '') === (r.color || '') && (c.color2 || '') === (r.color2 || '')))
  const rows = queue.map((r) => ({ ...r, dup: exists(r) }))
  const todo = rows.filter((r) => !r.dup && r.status !== 'lookup')

  // Neue Dateien: erst aus dem Dateinamen lesen, bei Namen wie SFD-042 danach in der Riftcodex-Datenbank nachschlagen.
  async function choose(files) {
    setMsg('')
    const list = [...files].map((file, i) => {
      const sn = parseSetNumber(file.name)
      const base = parseCardFilename(file.name, { kind, color })
      return { key: Date.now() + '-' + i, file, ...base, sn, code: null, note: '', status: sn ? 'lookup' : 'name' }
    })
    setQueue(list)
    for (const r of list.filter((x) => x.sn)) await lookupRow(r.key, r.sn, r.file.name)
  }
  // Karte in der Riftcodex-Datenbank nachschlagen und die Felder der Zeile füllen
  async function lookupRow(key, sn, fallbackName) {
    const update = (patch) => setQueue((qq) => qq.map((r) => (r.key === key ? { ...r, ...patch } : r)))
    update({ status: 'lookup' })
    try {
      const c = await fetchCardInfo(sn.set, sn.num)
      if (!c) { update({ ...(fallbackName ? { name: fallbackName.replace(/\.[^.]+$/, '') } : {}), status: 'notfound' }); return }
      const m = mapApiCard(c)
      update({
        name: m.name, kind: m.kind, color: m.color, color2: m.color2, signature: m.signature, code: m.code, status: 'found',
        note: m.ignoredDomain ? `Datenbank nennt 2 Farben, übernommen wird nur ${m.color} (zweite Farbe nur bei Legend/Signature)` : '',
      })
    } catch (e) {
      update({ status: 'error' })
    }
  }
  const edit = (key, patch) =>
    setQueue((qq) => qq.map((r) => {
      if (r.key !== key) return r
      const n = { ...r, ...patch }
      if (!allowsSecondColor(n.kind, n.signature)) n.color2 = null
      return n
    }))

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
        name: r.name, kind: r.kind, color: r.color || null, color2: allowsSecondColor(r.kind, r.signature) ? r.color2 || null : null,
        signature: !!r.signature, code: r.code || null, image_url: data.publicUrl, image_path: path,
      })
      if (ins.error) {
        await supabase.storage.from('cards').remove([path])
        setMsg(dbHint(ins.error.message))
      } else ok++
    }
    setBusy(false)
    if (ok === todo.length) setQueue([])
    setMsg((m) => `${ok} von ${todo.length} Karten hochgeladen.${m && ok !== todo.length ? ' ' + m : ''}`)
    load()
  }

  const patch = async (id, values) => {
    const { error } = await supabase.from('cards').update(values).eq('id', id)
    if (error) setMsg(dbHint(error.message))
    load()
  }
  // Name, Art und Farben anhand des Codes neu aus der Kartendatenbank holen
  async function reload(c) {
    const sn = parseSetNumber(c.code || '')
    if (!sn) return
    setMsg('Frage Kartendatenbank ab…')
    try {
      const info = await fetchCardInfo(sn.set, sn.num)
      if (!info) return setMsg(`${c.code} wurde in der Kartendatenbank nicht gefunden.`)
      const m = mapApiCard(info)
      await patch(c.id, { name: m.name, kind: m.kind, color: m.color, color2: m.color2, signature: m.signature, code: m.code })
      setMsg(`${m.code}: ${m.name} aktualisiert.`)
    } catch (e) {
      setMsg('Kartendatenbank nicht erreichbar.')
    }
  }
  async function remove(c) {
    if (!confirm(`„${c.name}“ löschen?`)) return
    if (c.image_path) await supabase.storage.from('cards').remove([c.image_path])
    await supabase.from('cards').delete().eq('id', c.id)
    load()
  }

  const shown = cards.filter((c) => (c.name + ' ' + (c.code || '')).toLowerCase().includes(q.toLowerCase()))

  return (
    <div className="stack">
      <section className="panel">
        <h2>Karten hochladen</h2>
        <p className="muted">
          Dateien mit Set-Nummer im Namen, zum Beispiel <code>SFD-042.webp</code>, werden automatisch in der offenen
          Riftcodex-Kartendatenbank nachgeschlagen (Name, Art, Farben, Signature). Alternativ geht auch <code>name_art_farbe_rest.webp</code>,
          zum Beispiel <code>riven_unit_calm_3m-4p.webp</code>; zweifarbig bei Legend/Signature: <code>viktor_legend_fury_mind.png</code>.
          Du kannst alles in der Vorschau noch korrigieren. Fehlt etwas, gelten diese Standardwerte:
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
              <thead><tr><th>Bilddatei</th><th>Kartenname</th><th>Code / Dateiname (z. B. OGN-001)</th><th>Art</th><th>Signature</th><th>Farbe</th><th>Farbe 2</th><th>Status</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const two = allowsSecondColor(r.kind, r.signature)
                  return (
                    <tr key={r.key} className={r.dup ? 'skip' : ''}>
                      <td className="muted">{r.file.name}</td>
                      <td><input value={r.name} onChange={(e) => edit(r.key, { name: e.target.value })} /></td>
                      <td>
                        <input value={r.code || ''} placeholder="OGN-001" onChange={(e) => edit(r.key, { code: e.target.value })}
                          onBlur={(e) => {
                            const sn = parseSetNumber(e.target.value.trim())
                            if (sn && r.sn?.set + r.sn?.num !== sn.set + sn.num) { edit(r.key, { sn, code: `${sn.set}-${sn.num}`.toUpperCase() }); lookupRow(r.key, sn) }
                            else if (sn) edit(r.key, { code: `${sn.set}-${sn.num}`.toUpperCase() })
                          }} />
                      </td>
                      <td>
                        <select value={r.kind} onChange={(e) => edit(r.key, { kind: e.target.value })}>
                          {KINDS.map((k) => <option key={k}>{k}</option>)}
                        </select>
                      </td>
                      <td><input type="checkbox" checked={!!r.signature} onChange={(e) => edit(r.key, { signature: e.target.checked })} /></td>
                      <td>
                        <select value={r.color || ''} onChange={(e) => edit(r.key, { color: e.target.value || null })}>
                          <option value="">–</option>
                          {COLORS.map((k) => <option key={k}>{k}</option>)}
                        </select>
                      </td>
                      <td>
                        {two ? (
                          <select value={r.color2 || ''} onChange={(e) => edit(r.key, { color2: e.target.value || null })}>
                            <option value="">–</option>
                            {COLORS.filter((k) => k !== r.color).map((k) => <option key={k}>{k}</option>)}
                          </select>
                        ) : <span className="muted">nur Legend/Signature</span>}
                      </td>
                      <td>
                        {r.dup ? 'schon vorhanden, wird übersprungen'
                          : r.status === 'lookup' ? 'sucht in der Kartendatenbank…'
                          : r.status === 'notfound' ? <span className="warn">nicht gefunden, bitte selbst ausfüllen</span>
                          : r.status === 'error' ? <span className="warn">Datenbank nicht erreichbar, bitte selbst ausfüllen</span>
                          : r.kind === 'Rune' && !r.color ? <span className="warn">Rune ohne Farbe</span>
                          : r.kind === 'Legend' && !r.color2 ? <span>{r.status === 'found' ? 'automatisch erkannt' : 'bereit'} · einfarbig</span>
                          : r.status === 'found' ? 'automatisch erkannt'
                          : 'bereit'}
                        {r.note && <div className="warn small">{r.note}</div>}
                      </td>
                    </tr>
                  )
                })}
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
          {shown.map((c) => {
            const two = allowsSecondColor(c.kind, c.signature)
            return (
              <div key={c.id} className="admin-card">
                <CardImg src={c.image_url} alt={c.name} loading="lazy" battlefield={c.kind === 'Battlefield'} />
                <label className="small muted">Kartenname auf dem Bild
                  <input defaultValue={c.name} onBlur={(e) => e.target.value !== c.name && patch(c.id, { name: e.target.value })} />
                </label>
                <label className="small muted">Code / Dateiname (z. B. OGN-001)
                  <span className="codeline">
                    <input defaultValue={c.code || ''} placeholder="OGN-001" onBlur={(e) => {
                      const v = e.target.value.trim()
                      const sn = parseSetNumber(v)
                      const val = sn ? `${sn.set}-${sn.num}`.toUpperCase() : v
                      if (val !== (c.code || '')) patch(c.id, { code: val || null })
                    }} />
                    <button title="Name, Art und Farben aus der Kartendatenbank holen" disabled={!c.code || !parseSetNumber(c.code)} onClick={() => reload(c)}>↻</button>
                  </span>
                </label>
                <select value={c.kind} onChange={(e) => patch(c.id, { kind: e.target.value, ...(allowsSecondColor(e.target.value, c.signature) ? {} : { color2: null }) })}>
                  {KINDS.map((k) => <option key={k}>{k}</option>)}
                </select>
                <label className="check small">
                  <input type="checkbox" checked={!!c.signature} onChange={(e) => patch(c.id, { signature: e.target.checked, ...(allowsSecondColor(c.kind, e.target.checked) ? {} : { color2: null }) })} />
                  Signature
                </label>
                <select value={c.color || ''} onChange={(e) => patch(c.id, { color: e.target.value || null })}>
                  <option value="">keine Farbe</option>
                  {COLORS.map((k) => <option key={k}>{k}</option>)}
                </select>
                {two && (
                  <select value={c.color2 || ''} onChange={(e) => patch(c.id, { color2: e.target.value || null })}>
                    <option value="">keine 2. Farbe</option>
                    {COLORS.filter((k) => k !== c.color).map((k) => <option key={k}>{k}</option>)}
                  </select>
                )}
                <button className="danger" onClick={() => remove(c)}>Löschen</button>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
