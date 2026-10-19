import { useEffect, useMemo, useState } from 'react'
import { supabase, fetchAllCards } from './supabase'
import { KINDS, COLORS, DECK_RULES, analyzeDeck, canAdd, colorsOf, legendColors, fitsLegend, parseDeckList, formatDeckList } from './game'
import CardImg from './CardImg'
import Pager, { usePaging, pageSlice } from './Pager'

export const COLOR_HEX = { Fury: '#e5584a', Calm: '#4fb98a', Mind: '#4f94e8', Body: '#f0953a', Chaos: '#a463e0', Order: '#e8c547' }
const KIND_FILTERS = [...KINDS, 'Signature']
// Sortierkriterien: lassen sich beliebig stapeln (Prio 1, Prio 2, …)
const setOf = (c) => (c.code || '').split('-')[0] || ''
const numOf = (c) => parseInt((c.code || '').split('-')[1] || '', 10)
const SORT_KEYS = {
  name: ['Name', (c) => c.name.toLowerCase()],
  energy: ['Energy', (c) => c.energy],
  might: ['Might', (c) => c.might],
  power: ['Power', (c) => c.power],
  color: ['Farbe', (c) => { const i = COLORS.indexOf(c.color); return i < 0 ? null : i * 10 + (COLORS.indexOf(c.color2) + 1) }],
  kind: ['Art', (c) => { const i = KINDS.indexOf(c.kind); return i < 0 ? null : i }],
  signature: ['Signature', (c) => (c.signature ? 0 : 1)],
  set: ['Set', (c) => setOf(c) || null],
  number: ['Nummer', (c) => (Number.isNaN(numOf(c)) ? null : numOf(c))],
}
const cmpVals = (a, b) => (typeof a === 'string' || typeof b === 'string' ? String(a).localeCompare(String(b)) : a - b)
// Grundsortierung (immer aktiv): Set, dann Kartennummer; Varianten (OGN-234s, 121a, *) direkt hinter der Originalkarte
const baseKey = (c) => {
  const re = /(?:^|[^A-Za-z])([A-Za-z]{2,4})[-_\s]?(T|SP)?\s?0*(\d{1,3})([A-Za-z*]*)/i
  const m = (c.code || '').match(re) || (c.name || '').match(re)
  if (!m) return { set: '\uffff', kind: 3, num: 0, suf: '', name: (c.name || '').toLowerCase() } // ohne Code ganz ans Ende
  let suf = m[4] || ''
  if (!suf) { const n = (c.name || '').match(re); if (n && n[1].toLowerCase() === m[1].toLowerCase() && n[3] === m[3]) suf = n[4] || '' }
  return { set: m[1].toLowerCase(), kind: m[2] ? (m[2].toLowerCase() === 't' ? 1 : 2) : 0, num: Number(m[3]), suf: suf.toLowerCase(), name: (c.name || '').toLowerCase() }
}
const cmpBase = (x, y) => {
  const a = baseKey(x), b = baseKey(y)
  return a.set.localeCompare(b.set) || a.kind - b.kind || a.num - b.num || (a.suf === '' ? -1 : 0) - (b.suf === '' ? -1 : 0) || a.suf.localeCompare(b.suf) || a.name.localeCompare(b.name)
}
function sortCards(list, sorts) {
  return [...list].sort((x, y) => {
    for (const s of sorts) {
      const f = SORT_KEYS[s.key]?.[1]
      if (!f) continue
      const a = f(x), b = f(y)
      const an = a === null || a === undefined, bn = b === null || b === undefined
      if (an && bn) continue
      if (an) return 1   // Karten ohne Wert immer ans Ende
      if (bn) return -1
      const d = cmpVals(a, b)
      if (d) return s.dir === 'desc' ? -d : d
    }
    return cmpBase(x, y)
  })
}

export default function DeckBuilder() {
  const [cards, setCards] = useState([])
  const [decks, setDecks] = useState([])
  const [deckId, setDeckId] = useState(null)
  const [name, setName] = useState('Neues Deck')
  const [qty, setQty] = useState({})
  const [q, setQ] = useState('')
  const [kinds, setKinds] = useState([])       // leer = alle Arten
  const [colors, setColors] = useState([])     // leer = alle Farben
  const [champ, setChamp] = useState(null)     // gewählter Champion (kommt beim Spielstart direkt in die Champion-Zone)
  const [listText, setListText] = useState('')
  const [msg, setMsg] = useState('')
  const [missing, setMissing] = useState([])    // beim Import nicht gefundene Karten
  const [sorts, setSorts] = useState(() => { try { return JSON.parse(localStorage.getItem('rt:sorts')) || [] } catch { return [] } })
  useEffect(() => { try { localStorage.setItem('rt:sorts', JSON.stringify(sorts)) } catch { /* egal */ } }, [sorts])
  const paging = usePaging('deck', [q, kinds, colors, sorts])

  const loadDecks = async () => {
    const { data } = await supabase.from('decks').select('*').order('created_at', { ascending: false })
    setDecks(data || [])
  }
  useEffect(() => {
    fetchAllCards('name', true).then(({ data }) => setCards(data || []))
    loadDecks()
  }, [])

  const byId = useMemo(() => Object.fromEntries(cards.map((c) => [c.id, c])), [cards])
  const a = useMemo(() => analyzeDeck(qty, byId), [qty, byId])
  // Die gewählte Legend begrenzt die Farben: der Farbfilter schaltet sich automatisch auf ihre Farben, andere Farben lassen sich nicht hinzufügen
  const allowed = useMemo(() => legendColors(qty, byId), [qty, byId])
  const allowedKey = allowed.join(',')
  useEffect(() => { setColors(allowed) }, [allowedKey]) // eslint-disable-line
  // Farbfilter trifft beide Farben einer Karte (zweifarbige Legends und Signature-Karten erscheinen bei beiden Farben)
  // Filter: nichts gewählt = alles; sonst genügt es, wenn die Karte mindestens eine der gewählten Farben bzw. Arten hat.
  const shown0 = cards.filter(
    (c) => c.name.toLowerCase().includes(q.toLowerCase())
      && (!kinds.length || kinds.some((k) => (k === 'Signature' ? !!c.signature : c.kind === k)))
      && (!colors.length || colorsOf(c).some((x) => colors.includes(x))),
  )
  const shown = useMemo(() => sortCards(shown0, sorts), [shown0, sorts]) // eslint-disable-line
  const toggle = (set, v) => set((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]))

  function add(card) {
    const reason = canAdd(qty, byId, card)
    if (reason) return setMsg(reason)
    setMsg('')
    setQty((cur) => ({ ...cur, [card.id]: (cur[card.id] || 0) + 1 }))
  }
  function remove1(id) {
    setMsg('')
    setQty((cur) => {
      const n = (cur[id] || 0) - 1
      const next = { ...cur, [id]: n }
      if (n <= 0) { delete next[id]; if (id === champ) setChamp(null) }
      return next
    })
  }

  function open(d) {
    setDeckId(d.id); setName(d.name); setMsg('')
    setQty(Object.fromEntries((d.cards || []).map((e) => [e.card_id, e.qty])))
    setChamp((d.cards || []).find((e) => e.champion)?.card_id || null)
  }
  function fresh() { setDeckId(null); setName('Neues Deck'); setQty({}); setChamp(null); setMsg('') }

  // Deckliste einlesen: Abschnitte Legend / Champion / MainDeck / Battlefields / Runes, Zeilen wie "3 Kartenname"
  function importList() {
    const r = parseDeckList(listText, cards)
    setMissing(r.missing)
    if (!Object.keys(r.qty).length) return setMsg('In der Liste wurde keine bekannte Karte gefunden.')
    setQty(r.qty)
    setChamp(r.champion)
    const bits = [`${Object.values(r.qty).reduce((a, b) => a + b, 0)} Karten übernommen`]
    if (r.side) bits.push(`Sideboard (${r.side} Karten) wird nicht gespielt und ignoriert`)
    if (r.missing.length) bits.push(`${r.missing.length} Karten nicht gefunden (Liste oben auf der Seite), bitte von Hand hinzufügen`)
    setMsg(bits.join('. ') + '.')
  }

  async function save() {
    const list = Object.entries(qty).map(([card_id, n]) => (card_id === champ ? { card_id, qty: n, champion: true } : { card_id, qty: n }))
    const res = deckId
      ? await supabase.from('decks').update({ name, cards: list }).eq('id', deckId).select().single()
      : await supabase.from('decks').insert({ name, cards: list }).select().single()
    if (res.error) return setMsg(res.error.message)
    setDeckId(res.data.id)
    setMsg('Gespeichert.')
    loadDecks()
  }
  async function del() {
    if (!deckId || !confirm(`Deck „${name}“ löschen?`)) return
    await supabase.from('decks').delete().eq('id', deckId)
    fresh(); loadDecks()
  }

  const R = DECK_RULES
  const check = (ok, text) => <li className={ok ? 'ok' : 'bad'}>{ok ? '✓' : '•'} {text}</li>
  const inDeck = Object.entries(qty).map(([id, n]) => ({ card: byId[id], n })).filter((e) => e.card)

  return (
    <div className="deckbuilder">
      {missing.length > 0 && (
        <div className="missingbox wide" role="alert">
          <div className="row"><b>{missing.length} Karten aus der Liste wurden nicht gefunden – bitte manuell hinzufügen:</b>
            <button className="link" onClick={() => setMissing([])}>Ausblenden</button></div>
          <ul>{missing.map((m, i) => <li key={i}>{m}</li>)}</ul>
        </div>
      )}
      <aside className="panel">
        <h2>Meine Decks</h2>
        <div className="stack">
          {decks.map((d) => (
            <button key={d.id} className={'deckrow' + (d.id === deckId ? ' on' : '')} onClick={() => open(d)}>{d.name}</button>
          ))}
          <button onClick={fresh}>Neues Deck</button>
        </div>
        <hr />
        <input value={name} onChange={(e) => setName(e.target.value)} />
        {allowed.length > 0 && <p className="small"><span className="muted">Legend-Farben:</span> {allowed.map((c) => <span key={c} className="chip gold" style={{ background: COLOR_HEX[c], color: '#10151c', marginRight: 4 }}>{c}</span>)}</p>}
        <ul className="rules">
          {check(a.main === R.main, `Deck ${a.main} von ${R.main}`)}
          {check(a.legend === R.legend, `Legend ${a.legend} von ${R.legend}`)}
          {check(a.battlefield === R.battlefields, `Battlefields ${a.battlefield} von ${R.battlefields}`)}
          {check(a.rune === R.runes, `Runen ${a.rune} von ${R.runes}`)}
          {check(a.colors.length <= R.runeColors, `Runenfarben ${a.colors.join(', ') || 'keine'} (max. ${R.runeColors})`)}
        </ul>
        {a.valid && <p className="okmsg">Das Deck ist spielbereit.</p>}
        <ul className="decklist">
          {inDeck.map(({ card, n }) => (
            <li key={card.id}>
              <span>{n}× {card.name}{card.id === champ && <span className="chip gold"> Champion</span>}</span>
              <span>
                {(card.kind === 'Champion' || card.id === champ) && (
                  <button title="Als Champion festlegen (startet direkt in der Champion-Zone)" className={card.id === champ ? 'primary' : ''}
                    onClick={() => setChamp(card.id === champ ? null : card.id)}>★</button>
                )}
                <button onClick={() => remove1(card.id)}>−</button><button onClick={() => add(card)}>+</button>
              </span>
            </li>
          ))}
        </ul>
        <details className="importbox">
          <summary>Deckliste einfügen / anzeigen</summary>
          <textarea rows="10" value={listText} onChange={(e) => setListText(e.target.value)}
            placeholder={'Legend:\n1 Leona, Radiant Dawn\n\nChampion:\n1 Leona, Zealot\n\nMainDeck:\n3 Solari Shieldbearer\n...\n\nBattlefields:\n1 Targon\'s Peak\n\nRunes:\n6 Calm Rune\n6 Order Rune'} />
          <div className="row">
            <button className="primary" onClick={importList} disabled={!cards.length}>Liste übernehmen</button>
            <button onClick={() => setListText(formatDeckList(qty, byId, champ))}>Aktuelles Deck als Liste</button>
          </div>
          <p className="muted small">Ersetzt das Deck im Editor. Gespeichert wird erst mit „Speichern“. Runen werden über die Farbe gefunden („6 Calm Rune“).</p>
        </details>
        <div className="row">
          <button className="primary" onClick={save}>Speichern</button>
          {deckId && <button className="danger" onClick={del}>Löschen</button>}
        </div>
        {msg && <p className="warn">{msg}</p>}
      </aside>

      <section>
        <div className="filters">
          <input placeholder="Karte suchen" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="fgroup" role="group" aria-label="Farben">
            {COLORS.map((k) => (
              <button key={k} className={'fbtn' + (colors.includes(k) ? ' on' : '')} aria-pressed={colors.includes(k)}
                style={{ '--fc': COLOR_HEX[k] }} onClick={() => toggle(setColors, k)}>
                <i className="cdot" />{k}
              </button>
            ))}
          </div>
          <div className="fgroup" role="group" aria-label="Arten">
            {KIND_FILTERS.map((k) => (
              <button key={k} className={'fbtn' + (kinds.includes(k) ? ' on' : '')} aria-pressed={kinds.includes(k)} onClick={() => toggle(setKinds, k)}>{k}</button>
            ))}
          </div>
          <div className="sortbar">
            <span className="muted">Sortieren:</span>
            {sorts.map((s, i) => (
              <span key={i} className="sortchip">
                <b>{i + 1}.</b>
                <select value={s.key} aria-label={`Sortierung ${i + 1}`} onChange={(e) => setSorts((cur) => cur.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}>
                  {Object.entries(SORT_KEYS).map(([k, [label]]) => <option key={k} value={k}>{label}</option>)}
                </select>
                <button title="Richtung wechseln" onClick={() => setSorts((cur) => cur.map((x, j) => (j === i ? { ...x, dir: x.dir === 'asc' ? 'desc' : 'asc' } : x)))}>{s.dir === 'asc' ? '↑' : '↓'}</button>
                <button title="Entfernen" onClick={() => setSorts((cur) => cur.filter((_, j) => j !== i))}>×</button>
              </span>
            ))}
            {sorts.length < Object.keys(SORT_KEYS).length && (
              <button onClick={() => setSorts((cur) => [...cur, { key: Object.keys(SORT_KEYS).find((k) => !cur.some((x) => x.key === k)), dir: 'asc' }])}>+ Sortierung</button>
            )}
          </div>
          {(colors.length > 0 || kinds.length > 0) && (
            <button className="link" onClick={() => { setColors([]); setKinds([]) }}>Filter zurücksetzen · {shown.length} Karten</button>
          )}
        </div>
        {cards.length === 0 && <p className="muted">Noch keine Karten vorhanden. Der Master lädt sie unter „Karten verwalten“ hoch.</p>}
        <Pager total={shown.length} paging={paging} />
        <div className="pick-grid">
          {pageSlice(shown, paging).items.map((c) => (
            <div key={c.id} className={'pick' + (qty[c.id] ? ' has' : '') + (c.kind !== 'Legend' && !fitsLegend(c, allowed) ? ' blocked' : '')}
                 title={c.kind !== 'Legend' && !fitsLegend(c, allowed) ? `Passt nicht zur Legend (${allowed.join(' / ')})` : undefined}>
              <CardImg src={c.image_url} alt={c.name} loading="lazy" battlefield={c.kind === 'Battlefield'} onClick={() => add(c)} />
              <div className="pickbar">
                <button onClick={() => remove1(c.id)}>−</button>
                <span>{qty[c.id] || 0}</span>
                <button onClick={() => add(c)}>+</button>
              </div>
              <div className="cap" title={c.name}>
                <b>{c.name}</b>
                <span className="muted">{[c.code, ...colorsOf(c), c.signature ? 'Signature' : null].filter(Boolean).join(' / ') || c.kind}</span>
              </div>
            </div>
          ))}
        </div>
        <Pager total={shown.length} paging={paging} />
      </section>
    </div>
  )
}
