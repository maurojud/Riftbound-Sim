import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { go } from './nav'
import { Table, MyBoard, CardView, GameCtx } from './Table'
import {
  ZONES, TARGET_LABEL, DEFAULT_SETTINGS, buildPlayer, moveCard, toggleFlag, draw, drawRune, shuffleZone, untapAll, addPoints,
  pickBattlefield, pickChampion, targetsFor, canTap, canFlip, analyzeDeck, isValidState,
} from './game'

export const SETTING_LABELS = {
  enforceTurns: 'Zugreihenfolge erzwingen (nur wer den Fokus hat, darf spielen)',
  trashTop: 'Oberste Trash-Karte der anderen sichtbar',
  trashInspect: 'Andere dürfen den ganzen Trash ansehen',
  handCount: 'Anzahl der Handkarten der anderen sichtbar',
  battlefieldRandom: 'Battlefield zufällig zuweisen (gilt für neue Deckwahl)',
}

const newest = (a, b) => (!a ? b : !b ? a : (a.ts || 0) >= (b.ts || 0) ? a : b)
const zoneAt = (x, y) => document.elementFromPoint(x, y)?.closest('[data-drop]')?.dataset.drop || null

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

function ContextMenu({ menu, onClose }) {
  const ref = useRef(null)
  const [pos, setPos] = useState({ left: menu.x, top: menu.y })
  useLayoutEffect(() => {
    const r = ref.current.getBoundingClientRect()
    setPos({
      left: Math.max(6, Math.min(menu.x, window.innerWidth - r.width - 6)),
      top: Math.max(6, Math.min(menu.y, window.innerHeight - r.height - 6)),
    })
  }, [menu])
  return (
    <div className="ctx-bg" onPointerDown={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }}>
      <div className="ctxmenu" ref={ref} style={pos} onPointerDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
        {menu.title && <div className="t strong">{menu.title}</div>}
        {menu.items.map((it, i) =>
          it.sep ? <div key={i} className="t">{it.sep}</div> : (
            <button key={i} disabled={it.disabled} onClick={() => { onClose(); it.run() }}>{it.label}</button>
          ))}
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

function HandFan({ hand, cards, cw, bind, drag }) {
  const [w, setW] = useState(window.innerWidth)
  useEffect(() => {
    const f = () => setW(window.innerWidth)
    addEventListener('resize', f)
    return () => removeEventListener('resize', f)
  }, [])
  const n = hand.length
  const step = n <= 1 ? 0 : Math.min(cw * 0.8, (w - 24 - cw) / (n - 1))
  const total = n ? cw + step * (n - 1) : 0
  const mid = (n - 1) / 2
  const over = drag?.over === 'hand' && drag.allowed.includes('hand')
  return (
    <div className={'fan' + (drag ? ' dragging' : '')} style={{ '--cw': cw + 'px', height: cw * 1.4 + 74 }}>
      <div className={'fan-drop' + (drag && drag.allowed.includes('hand') ? ' dropok' : '') + (over ? ' dropover' : '')} data-drop="hand" />
      {n === 0 && <span className="muted fan-empty">Keine Handkarten. Tippe auf dein Deck, um zu ziehen.</span>}
      <div className="fan-inner" style={{ width: total }}>
        {hand.map((inst, i) => {
          const off = i - mid
          const rot = off * (n > 6 ? 2.2 : 3.5)
          const dy = off * off * (n > 6 ? 0.9 : 2.5)
          return (
            <div key={inst.id} className="fan-card" style={{ left: step * i, transform: `translateY(${dy}px) rotate(${rot}deg)`, zIndex: i }}>
              <CardView card={cards[inst.cardId]} inst={inst} handlers={bind(inst)} dim={drag?.id === inst.id} />
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
  const [live, setLive] = useState({})            // per Broadcast empfangene Spielerzustände
  const [liveTable, setLiveTable] = useState(null) // per Broadcast empfangener Zugstatus
  const [mine, setMine] = useState(undefined)     // undefined = lädt, null = noch kein Deck
  const mineRef = useRef(undefined)
  const chRef = useRef(null)
  const [tab, setTab] = useState('play')
  const [modal, setModal] = useState(null)
  const [preview, setPreview] = useState(null)
  const [menu, setMenu] = useState(null)
  const [drag, setDrag] = useState(null)
  const dragRef = useRef(null)
  const ghostRef = useRef(null)
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
      .on('broadcast', { event: 'seat' }, ({ payload }) => setLive((l) => ({ ...l, [payload.seat]: payload.state })))
      .on('broadcast', { event: 'table' }, ({ payload }) => setLiveTable(payload))
      .on('broadcast', { event: 'settings' }, ({ payload }) => setRow((r) => r && { ...r, settings: payload }))
      .on('broadcast', { event: 'ping' }, () => { loadRow(); loadMembers() })
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

  async function commitTable(next) {
    const payload = { ...next, ts: Date.now() }
    setLiveTable(payload)
    chRef.current?.send({ type: 'broadcast', event: 'table', payload })
    const { error } = await supabase.rpc('set_table', { p_session: id, p_table: payload })
    if (error) setErr(error.message.includes('set_table') ? 'Zugfunktion fehlt in der Datenbank. Bitte supabase/migration-3.sql ausführen.' : error.message)
  }

  const players = members
    .filter((m) => m.seat)
    .sort((a, b) => a.seat - b.seat)
    .map((m) => {
      const s = m.seat === mySeat ? mine : newest(live[m.seat], row?.state?.players?.[m.seat])
      return { seat: m.seat, name: m.profiles?.username || 'Spieler', state: isValidState(s) ? s : null }
    })
  const nameOf = (seat) => players.find((p) => p.seat === seat)?.name || '?'
  const stateOf = (seat) => players.find((p) => p.seat === seat)?.state

  // ───────── Zug und Fokus ─────────
  const tableRaw = newest(liveTable, row?.state?.table)
  const turn = tableRaw?.seat ? tableRaw : null
  const enforce = settings.enforceTurns
  const canAct = mySeat != null && (!enforce || !turn || turn.focus === mySeat)
  const seats = players.map((p) => p.seat)
  const nextSeat = (s) => seats[(seats.indexOf(s) + 1) % seats.length]
  const canPassTurn = !turn || !enforce || (turn.seat === mySeat && turn.focus === mySeat)
  const canPassFocus = !!turn && (!enforce || turn.focus === mySeat)
  const passTurn = () => {
    if (!turn) return commitTable({ seat: mySeat, focus: mySeat, n: 1 })
    const s = nextSeat(turn.seat)
    commitTable({ seat: s, focus: s, n: (turn.n || 1) + 1 })
  }
  const passFocus = () => commitTable({ ...turn, focus: nextSeat(turn.focus) })
  const turnText = !turn
    ? 'Das Spiel hat noch nicht begonnen.'
    : `Zug ${turn.n || 1}: ${nameOf(turn.seat)} ist am Zug` + (turn.focus !== turn.seat ? `, Fokus bei ${nameOf(turn.focus)}` : '')

  // ───────── Karten-Interaktion: Klick, Rechtsklick/Langdruck, Drag and Drop ─────────
  function startDrag(inst, zone, card, w, x, y) {
    const allowed = targetsFor(card, zone)
    dragRef.current = { id: inst.id, allowed, over: null, w }
    setDrag({ id: inst.id, card, allowed, over: null, w, x, y })
  }
  function moveDrag(x, y) {
    const d = dragRef.current
    if (!d) return
    if (ghostRef.current) ghostRef.current.style.transform = `translate(${x - d.w / 2}px, ${y - d.w * 0.7}px)`
    const over = zoneAt(x, y)
    if (over !== d.over) { d.over = over; setDrag((s) => s && { ...s, over }) }
  }
  function endDrag(x, y) {
    const d = dragRef.current
    dragRef.current = null
    setDrag(null)
    const over = zoneAt(x, y)
    if (d && over && d.allowed.includes(over)) act((p) => moveCard(p, d.id, over))
  }
  useEffect(() => {
    if (drag && ghostRef.current) ghostRef.current.style.transform = `translate(${drag.x - drag.w / 2}px, ${drag.y - drag.w * 0.7}px)`
  }, [drag?.id]) // eslint-disable-line

  function bindCard(seat, zone, inst, opts = {}) {
    const card = cards[inst.cardId]
    const own = seat === mySeat
    const show = () => card && setPreview(card)
    if (!own) return { onClick: () => { if (!inst.faceDown) show() } }
    if (!canAct) return { onClick: show }

    const click = () => (zone === 'runes' ? act((p) => toggleFlag(p, inst.id, 'tapped')) : show())
    const openMenu = (x, y) => {
      const items = []
      if (canTap(card, zone)) items.push({ label: inst.tapped ? 'Enttappen' : 'Tappen', run: () => act((p) => toggleFlag(p, inst.id, 'tapped')) })
      if (canFlip(card, zone)) items.push({ label: inst.faceDown ? 'Aufdecken' : 'Verdecken', run: () => act((p) => toggleFlag(p, inst.id, 'faceDown')) })
      items.push({ label: 'Ansehen', run: show })
      const targets = targetsFor(card, zone)
      if (targets.length) {
        items.push({ sep: 'Verschieben nach' })
        targets.forEach((t) => items.push({ label: TARGET_LABEL[t], run: () => act((p) => moveCard(p, inst.id, t)) }))
      }
      setMenu({ x, y, title: card?.name, items })
    }
    const onContextMenu = (e) => { e.preventDefault(); openMenu(e.clientX, e.clientY) }
    const onPointerDown = (e) => {
      if (e.button > 0) return
      const sx = e.clientX
      const sy = e.clientY
      const w = e.currentTarget.getBoundingClientRect().width
      let dragging = false
      let long = false
      let moved = false
      const timer = setTimeout(() => { long = true; cleanup(); openMenu(sx, sy) }, 520)
      const move = (ev) => {
        if (long) return
        if (!dragging) {
          if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 8) return
          moved = true
          clearTimeout(timer)
          if (opts.noDrag) return
          dragging = true
          startDrag(inst, zone, card, w, ev.clientX, ev.clientY)
        }
        moveDrag(ev.clientX, ev.clientY)
      }
      const up = (ev) => {
        cleanup(); clearTimeout(timer)
        if (long) return
        if (dragging) endDrag(ev.clientX, ev.clientY)
        else if (!moved) click()
      }
      const cancel = () => { cleanup(); clearTimeout(timer); if (dragging) { dragRef.current = null; setDrag(null) } }
      function cleanup() {
        removeEventListener('pointermove', move)
        removeEventListener('pointerup', up)
        removeEventListener('pointercancel', cancel)
      }
      addEventListener('pointermove', move)
      addEventListener('pointerup', up)
      addEventListener('pointercancel', cancel)
    }
    return { onPointerDown, onContextMenu }
  }

  function onZone(seat, zone) {
    if (seat === mySeat) {
      if (zone === 'deck' && canAct) return act((p) => draw(p, 1))
      if (zone === 'runeDeck' && canAct) return act((p) => drawRune(p, 1))
      if (zone === 'trash' || zone === 'banish') setModal({ type: 'zone', zone, seat })
      return
    }
    if (zone === 'banish' || (zone === 'trash' && settings.trashInspect)) setModal({ type: 'zone', zone, seat })
  }

  if (err && !row) return <div className="center"><p className="error">{err}</p><button onClick={() => go('/')}>Zurück</button></div>
  if (!row) return <div className="center">Lade Session…</div>

  const pw = sessionStorage.getItem('pw:' + id)
  const joinUrl = `${location.origin}${location.pathname}#/join/${row.code}`
  const ctx = { cards, settings, mySeat, turn, canAct, bindCard, onZone, drag }

  const zoneModal = () => {
    const own = modal.seat === mySeat
    const list = stateOf(modal.seat)?.zones[modal.zone] || []
    return (
      <Modal title={`${ZONES[modal.zone]}${own ? '' : ' von ' + nameOf(modal.seat)} · ${list.length}`} onClose={() => setModal(null)}>
        <div className="zone-grid">
          {[...list].reverse().map((inst) => (
            <CardView key={inst.id} card={cards[inst.cardId]} inst={inst} reveal={own} small handlers={bindCard(modal.seat, modal.zone, inst, { noDrag: true })} />
          ))}
        </div>
        {list.length > 0 && <p className="muted small">Neueste Karte zuerst. Linksklick vergrößert{own ? ', Rechtsklick (oder lange drücken) öffnet Optionen' : ''}.</p>}
      </Modal>
    )
  }

  const overlays = (
    <>
      {modal?.type === 'zone' && zoneModal()}
      {modal?.type === 'settings' && (
        <Modal title="Optionen" onClose={() => setModal(null)}>
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
      {preview && (
        <div className="modal-bg preview-bg" onClick={() => setPreview(null)}>
          <img className="big" src={preview.image_url} alt={preview.name} />
        </div>
      )}
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
      {drag && (
        <div className="ghost" ref={ghostRef} style={{ width: drag.w }}>
          <img src={drag.card.image_url} alt="" draggable={false} />
        </div>
      )}
    </>
  )

  // ───────── Fernseher und Zuschauer: nur der Tisch ─────────
  if (view === 'tv' || view === 'watch') {
    return (
      <GameCtx.Provider value={ctx}>
        <div className="tv">
          <div className={'tvbar' + (players.length < 2 ? ' wait' : '')}>
            {view === 'tv' ? (
              <>
                <div><span className="muted">Code</span> <strong className="bigcode">{row.code}</strong></div>
                {pw && <div><span className="muted">Passwort</span> <strong>{pw}</strong></div>}
                {players.length < 2 && <div className="muted joinurl">{joinUrl}</div>}
              </>
            ) : <strong>Zuschauer · Code {row.code}</strong>}
            <div className="turnchip">{turnText}</div>
            <span className="spacer" />
            {isHost && <button onClick={() => setModal({ type: 'settings' })}>Optionen</button>}
            <button onClick={() => go('/')}>Verlassen</button>
          </div>
          {err && <p className="error pad">{err}</p>}
          <Table players={players} mySeat={null} />
          {overlays}
        </div>
      </GameCtx.Provider>
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
  const playing = mine && !mine.setup?.battlefield && !mine.setup?.champion
  const openMore = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    const items = [
      { label: '4 Karten ziehen', disabled: !canAct, run: () => act((p) => draw(p, 4)) },
      { label: 'Rune ziehen', disabled: !canAct, run: () => act((p) => drawRune(p, 1)) },
      { label: 'Deck mischen', disabled: !canAct, run: () => act((p) => shuffleZone(p, 'deck')) },
      { label: 'Runendeck mischen', disabled: !canAct, run: () => act((p) => shuffleZone(p, 'runeDeck')) },
      { label: 'Neues Deck wählen', run: () => { if (confirm('Neues Deck wählen? Dein Spielstand wird zurückgesetzt.')) commit(null) } },
      ...(isHost ? [{ label: 'Optionen', run: () => setModal({ type: 'settings' }) }] : []),
      { label: 'Session verlassen', run: () => go('/') },
    ]
    setMenu({ x: r.right - 190, y: r.bottom + 4, items })
  }

  return (
    <GameCtx.Provider value={ctx}>
      <div className="player">
        <div className="tabs">
          <button className={tab === 'play' ? 'on' : ''} onClick={() => setTab('play')}>Mein Spiel</button>
          <button className={tab === 'table' ? 'on' : ''} onClick={() => setTab('table')}>Ganzer Tisch</button>
          <span className="spacer" />
          <span className="muted small">Code {row.code}</span>
        </div>
        {err && <p className="error pad">{err}</p>}

        {mine === undefined ? <div className="center">Lade…</div> :
         mine === null ? (
          <div className="panel narrow"><DeckPicker cards={cards} onPick={(d) => commit(buildPlayer(d, cards, settings))} /></div>
         ) : !playing ? (
          <Setup mine={mine} cards={cards}
            onBattlefield={(iid) => act((p) => pickBattlefield(p, iid))}
            onChampion={(iid) => act((p) => pickChampion(p, iid))} />
         ) : (
          <>
            <div className="toolbar">
              <button className="primary" disabled={!canPassTurn} onClick={passTurn}>{turn ? 'Zug beenden' : 'Zug starten'}</button>
              <button disabled={!canPassFocus} onClick={passFocus}>Fokus abgeben</button>
              <span className="points">
                <button onClick={() => act((p) => addPoints(p, -1))} disabled={!canAct}>−</button>
                <strong>{mine.points} Punkte</strong>
                <button onClick={() => act((p) => addPoints(p, 1))} disabled={!canAct}>+</button>
              </span>
              <button disabled={!canAct} onClick={() => act((p) => draw(p, 1))}>Karte ziehen</button>
              <button disabled={!canAct} onClick={() => act(untapAll)}>Alles enttappen</button>
              <button onClick={openMore}>Mehr ▾</button>
            </div>
            <div className={'turnbar' + (enforce && turn && !canAct ? ' waiting' : '')}>
              {turnText}{enforce && turn && !canAct ? ' · Du bist noch nicht dran.' : ''}
            </div>

            {tab === 'table' ? (
              <Table players={players} mySeat={mySeat} />
            ) : (
              <div className="play-main" style={{ paddingBottom: fanCw * 1.4 + 90 }}>
                <div className="mine-board">
                  <MyBoard player={{ seat: mySeat, name: 'Du', state: mine }} />
                </div>
              </div>
            )}
            {tab === 'play' && (
              <HandFan hand={mine.zones.hand} cards={cards} cw={fanCw} drag={drag}
                bind={(inst) => bindCard(mySeat, 'hand', inst)} />
            )}
          </>
         )}
        {overlays}
      </div>
    </GameCtx.Provider>
  )
}
