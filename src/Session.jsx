import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { go } from './nav'
import { Table, PlayerArea, CardView } from './Table'
import {
  ZONES, TARGET_LABEL, DEFAULT_SETTINGS, buildPlayer, moveCard, toggleFlag, draw, drawRune, shuffleZone, untapAll, addPoints,
  pickBattlefield, pickChampion, targetsFor, canTap, canFlip, analyzeDeck, findInst, isValidState,
} from './game'

export const SETTING_LABELS = {
  trashTop: 'Oberste Trash-Karte der anderen sichtbar',
  trashInspect: 'Andere dürfen den ganzen Trash ansehen',
  handCount: 'Anzahl der Handkarten der anderen sichtbar',
  battlefieldRandom: 'Battlefield zufällig zuweisen (gilt für neue Deckwahl)',
}

const newest = (a, b) => (!a ? b : !b ? a : (a.ts || 0) >= (b.ts || 0) ? a : b)

function Modal({ title, onClose, children }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h3>{title}</h3><button onClick={onClose}>Schließen</button></div>
        {children}
      </div>
    </div>
  )
}

function DeckPicker({ cards, onPick }) {
  const [decks, setDecks] = useState(null)
  useEffect(() => { supabase.from('decks').select('*').order('created_at', { ascending: false }).then(({ data }) => setDecks(data || [])) }, [])
  return (
    <div className="stack">
      <h3>Deck wählen</h3>
      {decks === null && <p className="muted">Lade…</p>}
      {decks?.length === 0 && <p className="muted">Du hast noch kein Deck. Erstelle eines unter „Decks“.</p>}
      {decks?.map((d) => {
        const qty = Object.fromEntries((d.cards || []).map((e) => [e.card_id, e.qty]))
        const a = analyzeDeck(qty, cards)
        return (
          <button key={d.id} className="deckrow" onClick={() => onPick(d)}>
            <span>{d.name}{!a.valid && <span className="warn"> · unvollständig</span>}</span>
            <span className="muted">{a.main}+{a.rune} Karten</span>
          </button>
        )
      })}
    </div>
  )
}

function Setup({ mine, cards, onBattlefield, onChampion }) {
  const z = mine.zones
  if (mine.setup?.battlefield) {
    return (
      <div className="panel narrow">
        <h3>Wähle dein Battlefield</h3>
        <div className="zone-grid">
          {z.bfPool.map((i) => <CardView key={i.id} card={cards[i.cardId]} inst={i} onClick={() => onBattlefield(i.id)} />)}
        </div>
      </div>
    )
  }
  const seen = new Set()
  const unique = z.deck.filter((i) => (seen.has(i.cardId) ? false : seen.add(i.cardId)))
  return (
    <div className="panel narrow">
      <h3>Wähle deinen Champion</h3>
      <p className="muted">Eine Karte aus deinem Deck kommt in die Champion-Zone.</p>
      <div className="zone-grid">
        {unique.map((i) => <CardView key={i.id} small card={cards[i.cardId]} inst={i} onClick={() => onChampion(i.id)} />)}
      </div>
      <button onClick={() => onChampion(null)}>Ohne Champion starten</button>
    </div>
  )
}

function HandFan({ hand, cards, selId, cw, onSelect }) {
  const [w, setW] = useState(window.innerWidth)
  useEffect(() => {
    const f = () => setW(window.innerWidth)
    addEventListener('resize', f)
    return () => removeEventListener('resize', f)
  }, [])
  const n = hand.length
  const avail = w - 24
  const step = n <= 1 ? 0 : Math.min(cw * 0.8, (avail - cw) / (n - 1))
  const total = n ? cw + step * (n - 1) : 0
  const mid = (n - 1) / 2
  return (
    <div className="fan" style={{ '--cw': cw + 'px', height: cw * 1.4 + 74 }}>
      {n === 0 && <span className="muted fan-empty">Keine Handkarten. Tippe auf dein Deck, um zu ziehen.</span>}
      <div className="fan-inner" style={{ width: total }}>
        {hand.map((inst, i) => {
          const off = i - mid
          const sel = inst.id === selId
          const rot = sel ? 0 : off * (n > 6 ? 2.2 : 3.5)
          const dy = sel ? -58 : off * off * (n > 6 ? 0.9 : 2.5)
          return (
            <div key={inst.id} className="fan-card" style={{ left: step * i, transform: `translateY(${dy}px) rotate(${rot}deg) scale(${sel ? 1.15 : 1})`, zIndex: sel ? 100 : i }}>
              <CardView card={cards[inst.cardId]} inst={inst} selected={sel} onClick={() => onSelect(inst)} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function Session({ id, view, user }) {
  const [row, setRow] = useState(null)
  const [members, setMembers] = useState([])
  const [cards, setCards] = useState({})
  const [live, setLive] = useState({})          // per Broadcast empfangene Spielerzustände (sofort)
  const [mine, setMine] = useState(undefined)   // undefined = lädt, null = noch kein Deck
  const mineRef = useRef(undefined)
  const chRef = useRef(null)
  const [tab, setTab] = useState('play')
  const [sel, setSel] = useState(null)
  const [modal, setModal] = useState(null)
  const [err, setErr] = useState('')
  const [vw, setVw] = useState(window.innerWidth)

  useEffect(() => {
    const f = () => setVw(window.innerWidth)
    addEventListener('resize', f)
    return () => removeEventListener('resize', f)
  }, [])

  const me = members.find((m) => m.user_id === user.id)
  const mySeat = me?.seat ?? null
  const isHost = row?.host_id === user.id
  const settings = { ...DEFAULT_SETTINGS, ...(row?.settings || {}) }

  const loadRow = useCallback(async () => {
    const { data, error } = await supabase.from('sessions').select('*').eq('id', id).maybeSingle()
    if (error) setErr(error.message)
    else if (data) setRow(data)
    else setErr('Session nicht gefunden oder kein Zugriff.')
  }, [id])

  const loadMembers = useCallback(async () => {
    const { data } = await supabase.from('session_members').select('*, profiles(username)').eq('session_id', id)
    setMembers(data || [])
  }, [id])

  useEffect(() => {
    loadRow(); loadMembers()
    supabase.from('cards').select('*').then(({ data }) => setCards(Object.fromEntries((data || []).map((c) => [c.id, c]))))
    const ch = supabase
      .channel(`table-${id}`, { config: { broadcast: { self: false } } })
      // Schneller Weg: Spieler senden Änderungen direkt an alle Geräte
      .on('broadcast', { event: 'seat' }, ({ payload }) => setLive((l) => ({ ...l, [payload.seat]: payload.state })))
      .on('broadcast', { event: 'settings' }, ({ payload }) => setRow((r) => r && { ...r, settings: payload }))
      .on('broadcast', { event: 'ping' }, () => { loadRow(); loadMembers() })
      // Sicherer Weg: Datenbankänderungen
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions', filter: `id=eq.${id}` }, (p) => p.new && setRow((r) => ({ ...(r || {}), ...p.new })))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'session_members', filter: `session_id=eq.${id}` }, loadMembers)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') ch.send({ type: 'broadcast', event: 'ping', payload: {} })
      })
    chRef.current = ch
    const t = setInterval(() => { loadRow(); loadMembers() }, 3000) // Notfall-Auffrischung
    return () => { clearInterval(t); chRef.current = null; supabase.removeChannel(ch) }
  }, [id, loadRow, loadMembers])

  useEffect(() => {
    if (mySeat && row && mineRef.current === undefined) {
      const s = row.state?.players?.[mySeat]
      mineRef.current = isValidState(s) ? s : null
      setMine(mineRef.current)
    }
  }, [mySeat, row])

  async function commit(next) {
    const ts = Date.now()
    const payload = next ? { ...next, ts } : { ts }
    mineRef.current = next ? payload : null
    setMine(mineRef.current)
    chRef.current?.send({ type: 'broadcast', event: 'seat', payload: { seat: mySeat, state: payload } })
    const { error } = await supabase.rpc('set_seat_state', { p_session: id, p_state: payload })
    if (error) setErr(error.message)
  }
  const act = (fn) => mineRef.current && commit(fn(mineRef.current))

  const players = members
    .filter((m) => m.seat)
    .sort((a, b) => a.seat - b.seat)
    .map((m) => {
      const s = m.seat === mySeat ? mine : newest(live[m.seat], row?.state?.players?.[m.seat])
      return { seat: m.seat, name: m.profiles?.username || 'Spieler', state: isValidState(s) ? s : null }
    })
  const stateOf = (seat) => players.find((p) => p.seat === seat)?.state

  const selInfo = sel && mine ? findInst(mine, sel.id) : null
  const selCard = selInfo ? cards[selInfo.inst.cardId] : null

  function onCard(seat, zone, inst) {
    if (seat === mySeat) setSel((s) => (s?.id === inst.id ? null : { id: inst.id }))
    else if (!inst.faceDown) setModal({ type: 'preview', card: cards[inst.cardId] })
  }
  function onZone(seat, zone) {
    if (seat === mySeat) {
      if (zone === 'deck') return act((p) => draw(p, 1))
      if (zone === 'runeDeck') return act((p) => drawRune(p, 1))
      if (zone === 'trash' || zone === 'banish') setModal({ type: 'zone', zone, seat })
      return
    }
    if (zone === 'banish' || (zone === 'trash' && settings.trashInspect)) setModal({ type: 'zone', zone, seat })
  }

  if (err && !row) return <div className="center"><p className="error">{err}</p><button onClick={() => go('/')}>Zurück</button></div>
  if (!row) return <div className="center">Lade Session…</div>

  const pw = sessionStorage.getItem('pw:' + id)
  const joinUrl = `${location.origin}${location.pathname}#/join/${row.code}`

  const zoneModal = () => {
    const own = modal.seat === mySeat
    const list = stateOf(modal.seat)?.zones[modal.zone] || []
    const owner = players.find((p) => p.seat === modal.seat)?.name
    return (
      <Modal title={`${ZONES[modal.zone]}${own ? '' : ' von ' + owner} · ${list.length}`} onClose={() => setModal(null)}>
        <div className="zone-grid">
          {[...list].reverse().map((inst) => (
            <CardView key={inst.id} card={cards[inst.cardId]} inst={inst} reveal={own} small
              onClick={() => {
                if (own) { setSel({ id: inst.id }); setModal(null) }
                else if (!inst.faceDown) setModal({ type: 'preview', card: cards[inst.cardId] })
              }} />
          ))}
        </div>
        {list.length > 0 && <p className="muted small">Neueste Karte zuerst.</p>}
      </Modal>
    )
  }

  const modals = (
    <>
      {modal?.type === 'zone' && zoneModal()}
      {modal?.type === 'preview' && modal.card && (
        <Modal title={modal.card.name} onClose={() => setModal(null)}><img className="big" src={modal.card.image_url} alt={modal.card.name} /></Modal>
      )}
      {modal?.type === 'settings' && (
        <Modal title="Sichtbarkeit und Optionen" onClose={() => setModal(null)}>
          <div className="stack">
            {Object.entries(SETTING_LABELS).map(([k, label]) => (
              <label key={k} className="check">
                <input type="checkbox" checked={!!settings[k]} onChange={async (e) => {
                  const next = { ...settings, [k]: e.target.checked }
                  setRow({ ...row, settings: next })
                  chRef.current?.send({ type: 'broadcast', event: 'settings', payload: next })
                  await supabase.rpc('update_settings', { p_session: id, p_settings: next })
                }} />
                {label}
              </label>
            ))}
          </div>
        </Modal>
      )}
    </>
  )

  // ───────── Fernseher und Zuschauer: nur der Tisch ─────────
  if (view === 'tv' || view === 'watch') {
    return (
      <div className="tv">
        <div className="tvbar">
          {view === 'tv' ? (
            <>
              <div><span className="muted">Code</span> <strong className="bigcode">{row.code}</strong></div>
              {pw && <div><span className="muted">Passwort</span> <strong>{pw}</strong></div>}
              <div className="muted joinurl">{joinUrl}</div>
            </>
          ) : <strong>Zuschauer · Code {row.code}</strong>}
          <span className="spacer" />
          {isHost && <button onClick={() => setModal({ type: 'settings' })}>Sichtbarkeit</button>}
          <button onClick={() => go('/')}>Verlassen</button>
        </div>
        {err && <p className="error pad">{err}</p>}
        <Table players={players} cards={cards} settings={settings} mySeat={null} onCard={onCard} onZone={onZone} />
        {modals}
      </div>
    )
  }

  // ───────── Spieler auf Tablet oder Handy ─────────
  if (!mySeat) {
    return (
      <div className="center stack">
        <p>Du hast in dieser Session keinen Spielerplatz.</p>
        <button onClick={() => go(`/s/${id}/watch`)}>Zuschauen</button>
        <button onClick={() => go('/')}>Zurück</button>
      </div>
    )
  }

  const fanCw = vw < 700 ? 84 : 112
  const fanH = fanCw * 1.4 + 74
  const playing = mine && !mine.setup?.battlefield && !mine.setup?.champion

  const bar = playing && selInfo && (
    <div className="actionbar" style={{ bottom: tab === 'play' ? fanH : 0 }}>
      <div className="ab-head">
        <strong>{selCard?.name || 'Karte'}</strong>
        <span className="muted small">{ZONES[selInfo.zone]}</span>
        <span className="spacer" />
        <button onClick={() => selCard && setModal({ type: 'preview', card: selCard })}>Ansehen</button>
        <button onClick={() => setSel(null)}>Fertig</button>
      </div>
      <div className="ab-row">
        {canTap(selCard, selInfo.zone) && (
          <button className="primary" onClick={() => act((p) => toggleFlag(p, sel.id, 'tapped'))}>{selInfo.inst.tapped ? 'Enttappen' : 'Tappen'}</button>
        )}
        {canFlip(selCard, selInfo.zone) && (
          <button onClick={() => act((p) => toggleFlag(p, sel.id, 'faceDown'))}>{selInfo.inst.faceDown ? 'Aufdecken' : 'Verdecken'}</button>
        )}
        {targetsFor(selCard, selInfo.zone).map((t) => (
          <button key={t} onClick={() => { act((p) => moveCard(p, sel.id, t)); setSel(null) }}>{TARGET_LABEL[t]}</button>
        ))}
      </div>
    </div>
  )

  return (
    <div className="player">
      <div className="tabs">
        <button className={tab === 'play' ? 'on' : ''} onClick={() => setTab('play')}>Mein Spiel</button>
        <button className={tab === 'table' ? 'on' : ''} onClick={() => setTab('table')}>Ganzer Tisch</button>
        <span className="spacer" />
        <span className="muted small">Code {row.code}</span>
        {isHost && <button onClick={() => setModal({ type: 'settings' })}>Optionen</button>}
        <button onClick={() => go('/')}>Verlassen</button>
      </div>
      {err && <p className="error pad">{err}</p>}

      {mine === undefined ? <div className="center">Lade…</div> :
       mine === null ? (
        <div className="panel narrow"><DeckPicker cards={cards} onPick={(d) => commit(buildPlayer(d, cards, settings))} /></div>
       ) : !playing ? (
        <Setup mine={mine} cards={cards}
          onBattlefield={(iid) => act((p) => pickBattlefield(p, iid))}
          onChampion={(iid) => act((p) => pickChampion(p, iid))} />
       ) : tab === 'table' ? (
        <div style={{ paddingBottom: selInfo ? 130 : 20 }}>
          <Table players={players} cards={cards} settings={settings} mySeat={mySeat} selId={sel?.id} onCard={onCard} onZone={onZone} />
        </div>
       ) : (
        <div className="play-main" style={{ paddingBottom: fanH + (selInfo ? 130 : 20) }}>
          <div className="toolbar">
            <span className="points">
              <button onClick={() => act((p) => addPoints(p, -1))}>−</button>
              <strong>{mine.points} Punkte</strong>
              <button onClick={() => act((p) => addPoints(p, 1))}>+</button>
            </span>
            <button onClick={() => act((p) => draw(p, 4))}>4 Karten ziehen</button>
            <button onClick={() => act(untapAll)}>Alles enttappen</button>
            <button onClick={() => act((p) => shuffleZone(p, 'deck'))}>Deck mischen</button>
            <button onClick={() => act((p) => shuffleZone(p, 'runeDeck'))}>Runendeck mischen</button>
            <button onClick={() => { if (confirm('Neues Deck wählen? Dein Spielstand wird zurückgesetzt.')) { setSel(null); commit(null) } }}>Neues Deck</button>
          </div>
          <div className="mine-board">
            <PlayerArea player={{ seat: mySeat, name: 'Dein Spiel', state: mine }} cards={cards} settings={settings} isMe selId={sel?.id} onCard={onCard} onZone={onZone} />
          </div>
        </div>
       )}

      {bar}
      {playing && tab === 'play' && (
        <HandFan hand={mine.zones.hand} cards={cards} selId={sel?.id} cw={fanCw}
          onSelect={(inst) => onCard(mySeat, 'hand', inst)} />
      )}
      {modals}
    </div>
  )
}
