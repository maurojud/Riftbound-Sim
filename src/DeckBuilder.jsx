import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { KINDS, COLORS, DECK_RULES, analyzeDeck, canAdd, colorsOf, legendColors, fitsLegend, parseDeckList, formatDeckList } from './game'
import CardImg from './CardImg'

export const COLOR_HEX = { Fury: '#e5584a', Calm: '#4fb98a', Mind: '#4f94e8', Body: '#f0953a', Chaos: '#a463e0', Order: '#e8c547' }
const KIND_FILTERS = [...KINDS, 'Signature']

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

  const loadDecks = async () => {
    const { data } = await supabase.from('decks').select('*').order('created_at', { ascending: false })
    setDecks(data || [])
  }
  useEffect(() => {
    supabase.from('cards').select('*').order('name').then(({ data }) => setCards(data || []))
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
  const shown = cards.filter(
    (c) => c.name.toLowerCase().includes(q.toLowerCase())
      && (!kinds.length || kinds.some((k) => (k === 'Signature' ? !!c.signature : c.kind === k)))
      && (!colors.length || colorsOf(c).some((x) => colors.includes(x))),
  )
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
    if (!Object.keys(r.qty).length) return setMsg('In der Liste wurde keine bekannte Karte gefunden.')
    setQty(r.qty)
    setChamp(r.champion)
    const bits = [`${Object.values(r.qty).reduce((a, b) => a + b, 0)} Karten übernommen`]
    if (r.side) bits.push(`Sideboard (${r.side} Karten) wird nicht gespielt und ignoriert`)
    if (r.missing.length) bits.push(`nicht gefunden: ${r.missing.join('; ')}`)
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
  // Karten nach Art gruppiert anzeigen
  const groups = [
    ['Legend', (c) => c.kind === 'Legend'],
    ['Battlefields', (c) => c.kind === 'Battlefield'],
    ['Runen', (c) => c.kind === 'Rune'],
    ['Deck (Units, Spells, Gear …)', (c) => !['Legend', 'Battlefield', 'Rune'].includes(c.kind)],
  ]
  const inDeck = Object.entries(qty).map(([id, n]) => ({ card: byId[id], n })).filter((e) => e.card)

  return (
    <div className="deckbuilder">
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
          {(colors.length > 0 || kinds.length > 0) && (
            <button className="link" onClick={() => { setColors([]); setKinds([]) }}>Filter zurücksetzen · {shown.length} Karten</button>
          )}
        </div>
        {cards.length === 0 && <p className="muted">Noch keine Karten vorhanden. Der Master lädt sie unter „Karten verwalten“ hoch.</p>}
        {groups.map(([title, test]) => {
          const list = shown.filter(test)
          if (!list.length) return null
          return (
            <div key={title}>
              <h3 className="grouptitle">{title}</h3>
              <div className="pick-grid">
                {list.map((c) => (
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
                      <span className="muted">{[...colorsOf(c), c.signature ? 'Signature' : null].filter(Boolean).join(' / ') || c.kind}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </section>
    </div>
  )
}
