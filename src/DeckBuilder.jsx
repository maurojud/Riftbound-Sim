import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { KINDS, COLORS, DECK_RULES, analyzeDeck, canAdd, colorsOf } from './game'

export default function DeckBuilder() {
  const [cards, setCards] = useState([])
  const [decks, setDecks] = useState([])
  const [deckId, setDeckId] = useState(null)
  const [name, setName] = useState('Neues Deck')
  const [qty, setQty] = useState({})
  const [q, setQ] = useState('')
  const [kind, setKind] = useState('')
  const [color, setColor] = useState('')
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
  // Farbfilter trifft beide Farben einer Karte (zweifarbige Legends und Signature-Karten erscheinen bei beiden Farben)
  const shown = cards.filter(
    (c) => c.name.toLowerCase().includes(q.toLowerCase())
      && (!kind || (kind === 'Signature' ? !!c.signature : c.kind === kind))
      && (!color || colorsOf(c).includes(color)),
  )

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
      if (n <= 0) delete next[id]
      return next
    })
  }

  function open(d) {
    setDeckId(d.id); setName(d.name); setMsg('')
    setQty(Object.fromEntries((d.cards || []).map((e) => [e.card_id, e.qty])))
  }
  function fresh() { setDeckId(null); setName('Neues Deck'); setQty({}); setMsg('') }

  async function save() {
    const list = Object.entries(qty).map(([card_id, n]) => ({ card_id, qty: n }))
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
              <span>{n}× {card.name}</span>
              <span><button onClick={() => remove1(card.id)}>−</button><button onClick={() => add(card)}>+</button></span>
            </li>
          ))}
        </ul>
        <div className="row">
          <button className="primary" onClick={save}>Speichern</button>
          {deckId && <button className="danger" onClick={del}>Löschen</button>}
        </div>
        {msg && <p className="warn">{msg}</p>}
      </aside>

      <section>
        <div className="row">
          <input placeholder="Karte suchen" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">Alle Arten</option>
            {KINDS.map((k) => <option key={k}>{k}</option>)}
            <option>Signature</option>
          </select>
          <select value={color} onChange={(e) => setColor(e.target.value)}>
            <option value="">Alle Farben</option>
            {COLORS.map((k) => <option key={k}>{k}</option>)}
          </select>
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
                  <div key={c.id} className={'pick' + (qty[c.id] ? ' has' : '')}>
                    <img src={c.image_url} alt={c.name} loading="lazy" onClick={() => add(c)} />
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
