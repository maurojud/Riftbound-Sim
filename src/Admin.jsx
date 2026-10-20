import { useEffect, useState } from 'react'
import { shrinkImage } from './imgopt'
import { supabase, fetchAllCards } from './supabase'
import { KINDS, COLORS, parseCardFilename, allowsSecondColor, colorsOf as colorsOfCard, entersTapped } from './game'
const TOKEN_TYPES = ['Unit', 'Gear', 'Spell', 'Battlefield', 'Other']
const LEGEND_KINDS = ['Unit', 'Champion', 'Spell', 'Gear', 'Token']
import { parseSetNumber, extractCode, fetchCardInfo, mapApiCard } from './cardlookup'
import CardImg from './CardImg'
import Pager, { usePaging, pageSlice } from './Pager'

const dbHint = (m) => (/legend_energy|legend_power|legend_kinds|legend_tap/i.test(m || '') ? 'Datenbank-Update fehlt: bitte supabase/migration-7.sql im SQL Editor ausführen.'
  : /token_type|bf_mode|enters_ready/i.test(m || '') ? 'Datenbank-Update fehlt: bitte supabase/migration-6.sql im SQL Editor ausführen.'
  : /energy|might|power/i.test(m || '') ? 'Datenbank-Update fehlt: bitte supabase/migration-5.sql im SQL Editor ausführen.'
  : /color2|signature|\bcode\b/i.test(m || '') ? 'Datenbank-Update fehlt: bitte supabase/migration-4.sql im SQL Editor ausführen.' : m)
const BAD_NAME = /\d|[*#_]|\b[A-Za-z]{2,4}-\d/ // Namen mit Ziffern, Sternchen oder einem Code darin sind verdächtig
const numOrNull = (v) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v))

export default function Admin({ user }) {
  const [cards, setCards] = useState([])
  const [kind, setKind] = useState('Other')
  const [color, setColor] = useState('')
  const [queue, setQueue] = useState([])
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState('')
  const [fkind, setFkind] = useState('')
  const [fcolor, setFcolor] = useState('')
  const [fmode, setFmode] = useState('all')       // all | nocode | badname | novalues
  const [sel, setSel] = useState([])              // ausgewählte Karten-IDs
  const [recheckMode, setRecheckMode] = useState('fill')
  const [pfilter, setPfilter] = useState('all') // Vorschau-Filter: all | other | nocolor | notfound
  const paging = usePaging('admin', [q, fkind, fcolor, fmode])
  const [big, setBig] = useState(null)            // Karte, die gerade vergrößert wird

  const load = async () => {
    const { data } = await fetchAllCards('created_at', false)
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
      return { key: Date.now() + '-' + i, file, thumb: URL.createObjectURL(file), ...base, sn, code: null, energy: null, might: null, power: null, powerColors: '', note: '', status: sn ? 'lookup' : 'name' }
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
        name: m.name, kind: m.kind, color: m.color, color2: m.color2, signature: m.signature, code: m.code, energy: m.energy, might: m.might, power: m.power, powerColors: m.powerColors, status: 'found',
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
      let file = r.file
      try { const s = await shrinkImage(r.file); if (s.blob && s.blob.size < r.file.size) file = s.blob } catch { /* Original hochladen */ }
      const ext = file.type === 'image/webp' ? 'webp' : file.type === 'image/jpeg' ? 'jpg' : r.file.name.split('.').pop().toLowerCase()
      const path = `${crypto.randomUUID()}.${ext}`
      const up = await supabase.storage.from('cards').upload(path, file, { contentType: file.type, cacheControl: '31536000' })
      if (up.error) { setMsg(up.error.message); continue }
      const { data } = supabase.storage.from('cards').getPublicUrl(path)
      const ins = await supabase.from('cards').insert({
        name: r.name, kind: r.kind, color: r.color || null, color2: allowsSecondColor(r.kind, r.signature) ? r.color2 || null : null,
        signature: !!r.signature, code: r.code || null, image_url: data.publicUrl, image_path: path,
        energy: numOrNull(r.energy), might: numOrNull(r.might), power: numOrNull(r.power),
        power_colors: r.powerColors || (numOrNull(r.power) > 0 ? [r.color, r.color2].filter(Boolean).join(',') : null) || null,
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


  // Bereits hochgeladene Bilder verkleinern (neue Datei, Adresse in der Datenbank wird ersetzt, alte Datei gelöscht)
  const [opt, setOpt] = useState(null)
  async function optimizeAll() {
    if (!window.confirm('Alle zu großen Kartenbilder verkleinern? Das kann bei vielen Karten einige Minuten dauern. Das Fenster bitte offen lassen.')) return
    let checked = new Set()
    try { checked = new Set(JSON.parse(localStorage.getItem('rt:optdone') || '[]')) } catch { /* egal */ }
    const list = cards.filter((c) => c.image_url && !checked.has(c.id) && !(c.image_path || '').startsWith('opt/'))
    const st = { total: list.length, done: 0, shrunk: 0, saved: 0, failed: 0, running: true }
    setOpt({ ...st })
    let i = 0
    const worker = async () => {
      while (i < list.length) {
        const c = list[i++]
        try {
          const blob = await (await fetch(c.image_url)).blob()
          const s = await shrinkImage(blob)
          if (s.blob && s.blob.size < blob.size * 0.9) {
            const ext = s.blob.type === 'image/webp' ? 'webp' : 'jpg'
            const path = `opt/${c.id}.${ext}`
            const up = await supabase.storage.from('cards').upload(path, s.blob, { contentType: s.blob.type, cacheControl: '31536000', upsert: true })
            if (up.error) throw up.error
            const url = supabase.storage.from('cards').getPublicUrl(path).data.publicUrl
            const upd = await supabase.from('cards').update({ image_url: url, image_path: path }).eq('id', c.id)
            if (upd.error) throw upd.error
            if (c.image_path) await supabase.storage.from('cards').remove([c.image_path])
            st.shrunk++; st.saved += blob.size - s.blob.size
          }
          checked.add(c.id); try { localStorage.setItem('rt:optdone', JSON.stringify([...checked])) } catch { /* egal */ }
        } catch { st.failed++ }
        st.done++
        setOpt({ ...st })
      }
    }
    await Promise.all([worker(), worker(), worker()])
    st.running = false
    setOpt({ ...st })
    load()
  }

  const patch = async (id, values) => {
    const { error } = await supabase.from('cards').update(values).eq('id', id)
    if (error) setMsg(dbHint(error.message))
    load()
  }
  // Karten anhand ihres Codes neu in der Kartendatenbank prüfen. Der Code kommt aus dem Code-Feld, sonst aus dem Kartennamen.
  // Nur Set-Kürzel und Nummer zählen (OGN-023), Zeichen dahinter wie *, S oder a werden ignoriert.
  // mode "fill": nur Fehlendes ergänzen (Code, Werte, 2. Farbe, verdächtigen Namen ersetzen). mode "full": alles überschreiben.
  async function recheck(list, mode) {
    if (!list.length) return
    setBusy(true)
    const res = { ok: 0, nocode: [], notfound: [], error: [] }
    for (let i = 0; i < list.length; i++) {
      const c = list[i]
      setMsg(`Prüfe ${i + 1} von ${list.length}: ${c.name}…`)
      const sn = extractCode(c.code || '') || extractCode(c.name, 'name')
      if (!sn) { res.nocode.push(c.name); continue }
      try {
        const info = await fetchCardInfo(sn.set, sn.num)
        if (!info) { res.notfound.push(`${c.name} (${sn.set.toUpperCase()}-${sn.num})`); continue }
        const m = mapApiCard(info)
        const full = { name: m.name, kind: m.kind, color: m.color, color2: m.color2, signature: m.signature, code: m.code, energy: m.energy, might: m.might, power: m.power, power_colors: m.powerColors || null }
        let values = full
        if (mode === 'fill') {
          values = { code: m.code }
          if (BAD_NAME.test(c.name)) values.name = m.name
          if (c.color == null && m.color) values.color = m.color
          if (c.color2 == null && m.color2 && allowsSecondColor(c.kind, c.signature || m.signature)) values.color2 = m.color2
          if (c.energy == null && m.energy != null) values.energy = m.energy
          if (c.might == null && m.might != null) values.might = m.might
          if (c.power == null && m.power != null) values.power = m.power
          if (!c.power_colors && m.powerColors) values.power_colors = m.powerColors
        }
        const { error } = await supabase.from('cards').update(values).eq('id', c.id)
        if (error) { res.error.push(`${c.name}: ${dbHint(error.message)}`); if (/migration/.test(dbHint(error.message))) break } else res.ok++
      } catch (e) {
        res.error.push(`${c.name}: Kartendatenbank nicht erreichbar`)
        break
      }
    }
    setBusy(false)
    const bits = [`${res.ok} von ${list.length} Karten aktualisiert`]
    if (res.nocode.length) bits.push(`kein Code gefunden bei: ${res.nocode.join(', ')}`)
    if (res.notfound.length) bits.push(`nicht in der Datenbank: ${res.notfound.join(', ')}`)
    if (res.error.length) bits.push(`Fehler: ${res.error.join('; ')}`)
    setMsg(bits.join('. ') + '.')
    load()
  }
  // Alle ausgewählten Karten löschen (Bilder und Datenbank-Einträge)
  async function removeSelected() {
    const list = cards.filter((c) => sel.includes(c.id))
    if (!list.length) return
    if (!confirm(`${list.length} Karten wirklich löschen?\n\nGespeicherte Decks, in denen diese Karten vorkommen, verlieren sie dabei.`)) return
    setBusy(true)
    let done = 0
    for (let i = 0; i < list.length; i += 50) {
      const chunk = list.slice(i, i + 50)
      setMsg(`Lösche ${Math.min(i + 50, list.length)} von ${list.length}…`)
      const paths = chunk.map((c) => c.image_path).filter(Boolean)
      if (paths.length) await supabase.storage.from('cards').remove(paths)
      const { error } = await supabase.from('cards').delete().in('id', chunk.map((c) => c.id))
      if (error) { setMsg(error.message); break }
      done += chunk.length
    }
    setBusy(false)
    setSel([])
    setMsg(`${done} von ${list.length} Karten gelöscht.`)
    load()
  }
  async function remove(c) {
    if (!confirm(`„${c.name}“ löschen?`)) return
    if (c.image_path) await supabase.storage.from('cards').remove([c.image_path])
    await supabase.from('cards').delete().eq('id', c.id)
    load()
  }

  const shown = cards.filter((c) => (c.name + ' ' + (c.code || '')).toLowerCase().includes(q.toLowerCase())
    && (!fkind || (fkind === 'Signature' ? !!c.signature : c.kind === fkind))
    && (!fcolor || (fcolor === '__none' ? !colorsOfCard(c).length : colorsOfCard(c).includes(fcolor)))
    && (fmode === 'all' || (fmode === 'nocode' && !c.code) || (fmode === 'badname' && BAD_NAME.test(c.name))
      || (fmode === 'novalues' && c.energy == null && c.might == null && c.power == null)))
  const allSel = shown.length > 0 && shown.every((c) => sel.includes(c.id))
  const toggleAll = () => setSel(allSel ? sel.filter((id) => !shown.some((c) => c.id === id)) : [...new Set([...sel, ...shown.map((c) => c.id)])])
  const toggleOne = (id) => setSel((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
  const selected = cards.filter((c) => sel.includes(c.id))

  return (
    <div className="stack">
      <section className="panel">
        <h2>Ladezeit: Bilder verkleinern</h2>
        <p className="muted">Große Kartenbilder machen das Spiel langsam. Neue Uploads werden automatisch verkleinert (lange Seite höchstens 900 px, WebP). Mit diesem Knopf werden auch alle bereits hochgeladenen Karten verkleinert. Die Qualität bleibt auf Tisch, TV und in der Vorschau gut lesbar.</p>
        <div className="row">
          <button onClick={optimizeAll} disabled={!!opt?.running || !cards.length}>Alle vorhandenen Bilder verkleinern</button>
          {opt && <span className="muted">{opt.done} / {opt.total} geprüft · {opt.shrunk} verkleinert · {(opt.saved / 1048576).toFixed(1)} MB gespart{opt.failed ? ` · ${opt.failed} Fehler` : ''}{opt.running ? ' …' : ' · fertig'}</span>}
        </div>
      </section>
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
            <div className="row filterbar">
              <select value={pfilter} onChange={(e) => setPfilter(e.target.value)} aria-label="Vorschau filtern">
                <option value="all">Vorschau: alle ({rows.length})</option>
                <option value="other">Nur Art „Other“ ({rows.filter((r) => r.kind === 'Other').length})</option>
                <option value="nocolor">Nur farblos ({rows.filter((r) => !r.color).length})</option>
                <option value="notfound">Nur nicht in der Datenbank gefunden</option>
              </select>
            </div>
            <table className="preview">
              <thead><tr><th>Bild</th><th>Bilddatei</th><th>Kartenname</th><th>Code / Dateiname (z. B. OGN-001)</th><th>Art</th><th>Signature</th><th>Farbe</th><th>Farbe 2</th><th>Energy / Might / Power</th><th>Status</th></tr></thead>
              <tbody>
                {rows.filter((r) => pfilter === 'all' || (pfilter === 'other' && r.kind === 'Other') || (pfilter === 'nocolor' && !r.color)
                  || (pfilter === 'notfound' && (r.status === 'notfound' || r.status === 'error' || r.status === 'name'))).map((r) => {
                  const two = allowsSecondColor(r.kind, r.signature)
                  return (
                    <tr key={r.key} className={r.dup ? 'skip' : ''}>
                      <td><img className="thumb" src={r.thumb} alt="" title="Zum Vergrößern klicken" onClick={() => setBig({ image_url: r.thumb, name: r.name, kind: r.kind })} /></td>
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
                        <span className="nums">
                          {['energy', 'might', 'power'].map((f) => (
                            <input key={f} type="number" min="0" value={r[f] ?? ''} placeholder={f[0].toUpperCase()} title={f}
                              onChange={(e) => edit(r.key, { [f]: e.target.value === '' ? null : Number(e.target.value) })} />
                          ))}
                        </span>
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
          <h2>{shown.length === cards.length ? `${cards.length} Karten` : `${shown.length} von ${cards.length} Karten`}</h2>
          <input placeholder="Suchen (Name oder Code)" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="row filterbar">
          <select value={fkind} onChange={(e) => setFkind(e.target.value)}>
            <option value="">Alle Arten</option>
            {[...KINDS, 'Signature'].map((k) => <option key={k}>{k}</option>)}
          </select>
          <select value={fcolor} onChange={(e) => setFcolor(e.target.value)}>
            <option value="">Alle Farben</option>
            <option value="__none">Farblos (ohne Farbe)</option>
            {COLORS.map((k) => <option key={k}>{k}</option>)}
          </select>
          <select value={fmode} onChange={(e) => setFmode(e.target.value)}>
            <option value="all">Alle Karten</option>
            <option value="nocode">Ohne Code</option>
            <option value="badname">Name verdächtig (Ziffern, *, Code)</option>
            <option value="novalues">Ohne Energy/Might/Power</option>
          </select>
        </div>
        <div className="row selbar">
          <label className="check"><input type="checkbox" checked={allSel} onChange={toggleAll} />Alle {shown.length} angezeigten auswählen</label>
          <span className="muted">{selected.length} ausgewählt</span>
          <select value={recheckMode} onChange={(e) => setRecheckMode(e.target.value)} title="Wie stark die Karte überschrieben wird">
            <option value="fill">Nur Fehlendes ergänzen</option>
            <option value="full">Komplett neu prüfen (überschreibt)</option>
          </select>
          <button className="primary" disabled={busy || !selected.length} onClick={() => recheck(selected, recheckMode)}>Ausgewählte prüfen und aktualisieren</button>
          <button className="danger" disabled={busy || !selected.length} onClick={removeSelected}>Ausgewählte löschen ({selected.length})</button>
          {selected.length > 0 && <button className="link" onClick={() => setSel([])}>Auswahl aufheben</button>}
        </div>
        <p className="muted small">Der Code (z. B. OGN-023) wird aus dem Code-Feld gelesen, sonst aus dem Kartennamen. Zeichen dahinter wie * oder S werden ignoriert.</p>
        <Pager total={shown.length} paging={paging} />
        <div className="admin-grid">
          {pageSlice(shown, paging).items.map((c) => {
            const two = allowsSecondColor(c.kind, c.signature)
            return (
              <div key={c.id} className={'admin-card' + (sel.includes(c.id) ? ' picked' : '')}>
                <label className="selbox"><input type="checkbox" checked={sel.includes(c.id)} onChange={() => toggleOne(c.id)} aria-label="auswählen" /></label>
                <div className="imgbtn" title="Zum Vergrößern klicken" onClick={() => setBig(c)}>
                  <CardImg src={c.image_url} alt={c.name} loading="lazy" battlefield={c.kind === 'Battlefield'} />
                </div>
                <label className="small muted">Kartenname auf dem Bild
                  <input defaultValue={c.name} onBlur={(e) => e.target.value !== c.name && patch(c.id, { name: e.target.value })} />
                </label>
                <label className="small muted">Code / Dateiname (z. B. OGN-001)
                  <span className="codeline">
                    <input defaultValue={c.code || ''} placeholder="OGN-001" onBlur={(e) => {
                      const v = e.target.value.trim()
                      const sn = parseSetNumber(v) || extractCode(v)
                      const val = sn ? `${sn.set}-${sn.num}`.toUpperCase() : v
                      if (val !== (c.code || '')) patch(c.id, { code: val || null })
                    }} />
                    <button title="Diese Karte neu prüfen" disabled={busy} onClick={() => recheck([c], 'full')}>↻</button>
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
                <span className="nums">
                  {[['energy', 'Energy'], ['might', 'Might'], ['power', 'Power']].map(([f, label]) => (
                    <label key={f} className="small muted">{label}
                      <input type="number" min="0" defaultValue={c[f] ?? ''} key={c.id + f + (c[f] ?? '')}
                        onBlur={(e) => { const v = numOrNull(e.target.value); if (v !== (c[f] ?? null)) patch(c.id, { [f]: v }) }} />
                    </label>
                  ))}
                </span>
                <label className="small muted">Power-Farben (z. B. Fury,Mind)
                  <input defaultValue={c.power_colors || ''} key={c.id + 'pc' + (c.power_colors || '')}
                    onBlur={(e) => e.target.value !== (c.power_colors || '') && patch(c.id, { power_colors: e.target.value.trim() || null })} />
                </label>
                {c.kind === 'Legend' && (
                  <div className="legendpay">
                    <span className="small muted">Legend übernimmt Kosten (leer = keine)</span>
                    <span className="nums">
                      {[['legend_energy', 'Energy'], ['legend_power', 'Power']].map(([f, label]) => (
                        <label key={f} className="small muted">{label}
                          <input type="number" min="0" defaultValue={c[f] ?? ''} key={c.id + f + (c[f] ?? '')}
                            onBlur={(e) => { const v = numOrNull(e.target.value); if (v !== (c[f] ?? null)) patch(c.id, { [f]: v }) }} />
                        </label>
                      ))}
                    </span>
                    <label className="check small">
                      <input type="checkbox" checked={c.legend_tap !== false} onChange={(e) => patch(c.id, { legend_tap: e.target.checked })} />
                      Legend wird getappt, wenn sie Kosten übernimmt
                    </label>
                    <span className="small muted">Gilt für (nichts angehakt = alle Karten)</span>
                    <span className="legendkinds">
                      {LEGEND_KINDS.map((k) => {
                        const cur = String(c.legend_kinds || '').split(',').filter(Boolean)
                        return (
                          <label key={k} className="check small">
                            <input type="checkbox" checked={cur.includes(k)}
                              onChange={(e) => patch(c.id, { legend_kinds: (e.target.checked ? [...cur, k] : cur.filter((x) => x !== k)).join(',') || null })} />
                            {k}
                          </label>
                        )
                      })}
                    </span>
                  </div>
                )}
                {c.kind === 'Token' && (
                  <label className="small muted">Token-Typ
                    <select value={c.token_type || ''} onChange={(e) => patch(c.id, { token_type: e.target.value || null })}>
                      <option value="">nicht festgelegt</option>
                      {TOKEN_TYPES.map((t) => <option key={t}>{t}</option>)}
                    </select>
                  </label>
                )}
                {(c.kind === 'Battlefield' || (c.kind === 'Token' && c.token_type === 'Battlefield')) && (
                  <label className="small muted">Battlefield-Modus
                    <select value={c.bf_mode || ''} onChange={(e) => patch(c.id, { bf_mode: e.target.value || null })}>
                      <option value="">Standard (erstellt ein 3. Battlefield)</option>
                      <option value="extra">Erstellt ein 3. Battlefield</option>
                      <option value="overlay">Wird über ein Battlefield gelegt</option>
                    </select>
                  </label>
                )}
                {!['Spell', 'Battlefield', 'Legend', 'Rune'].includes(c.kind) && (
                  <label className="check small" title="Haken = kommt bereit ins Spiel, kein Haken = kommt getappt">
                    <input type="checkbox" checked={c.enters_ready == null ? !entersTapped(c) : !!c.enters_ready}
                      onChange={(e) => patch(c.id, { enters_ready: e.target.checked })} />
                    Kommt bereit (ready) ins Spiel
                  </label>
                )}
                <button className="danger" onClick={() => remove(c)}>Löschen</button>
              </div>
            )
          })}
        </div>
        <Pager total={shown.length} paging={paging} />
      </section>
      {big && (
        <div className="modal-bg preview-bg" onClick={() => setBig(null)}>
          <div className="pv">
            <div className={'pvimg' + (big.kind === 'Battlefield' ? ' bf' : '')}>
              <CardImg className="big" src={big.image_url} alt={big.name} battlefield={big.kind === 'Battlefield'} />
            </div>
            <strong>{big.name}</strong>
          </div>
        </div>
      )}
    </div>
  )
}
