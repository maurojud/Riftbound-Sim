import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { go } from './nav'
import { Table, MyBoard, CardView, CounterPanel, GameCtx } from './Table'
import {
  ZONES, DEFAULT_SETTINGS, buildPlayer, moveCard, toggleFlag, draw, drawRune, shuffleZone, untapAll, addPoints,
  pickBattlefield, pickChampion, targetsFor, canTap, canHide, canReveal, canMark, changeCounter, toggleStatus, clearMarks,
  analyzeDeck, fixState, findInst,
} from './game'

export const SETTING_LABELS = {
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

// Kleines Menü (nur für "Mehr"), keine Kartenmenüs mehr: Karten werden per Drag and Drop bewegt
function PopMenu({ menu, onClose }) {
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
      <div className="ctxmenu" ref={ref} style={pos} onPointerDown={(e) => e.stopPropagation()}>
        {menu.items.map((it, i) => (
          <button key={i} disabled={it.disabled} onClick={() => { onClose(); it.run() }}>{it.label}</button>
        ))}
      </div>
    </div>
  )
}

// Schwebendes Feld neben einer Karte (Zähler beim Hovern)
function Floating({ rect, children, onEnter, onLeave }) {
  const ref = useRef(null)
  const [pos, setPos] = useState({ left: rect.left, top: rect.bottom + 6 })
  useLayoutEffect(() => {
    const r = ref.current.getBoundingClientRect()
    let top = rect.bottom + 6
    if (top + r.height > window.innerHeight - 6) top = Math.max(6, rect.top - r.height - 6)
    setPos({ left: Math.max(6, Math.min(rect.left, window.innerWidth - r.width - 6)), top })
  }, [rect])
  return <div className="floating" ref={ref} style={pos} onPointerEnter={onEnter} onPointerLeave={onLeave}>{children}</div>
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

// Handkarten als Fächer. Jede Karte hat einen "Hide"-Schalter: verdeckt gespielte Karten sieht der Gegner nicht.
export function HandFan({ hand, cards, cw, bind, drag, onHide }) {
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
    <div className={'fan' + (drag ? ' dragging' : '') + (drag && drag.allowed.includes('hand') ? ' dropok' : '') + (over ? ' dropover' : '')}
      data-drop="hand" style={{ '--cw': cw + 'px', height: cw * 1.4 + 74 }}>
      <div className="fan-drop" data-drop="hand" />
      {n === 0 && <span className="muted fan-empty">Keine Handkarten. Tippe auf dein Deck, um zu ziehen.</span>}
      <div className="fan-inner" style={{ width: total }}>
        {hand.map((inst, i) => {
          const off = i - mid
          const rot = off * (n > 6 ? 2.2 : 3.5)
          const dy = off * off * (n > 6 ? 0.9 : 2.5)
          const hideable = canHide(cards[inst.cardId], 'hand')
          return (
            <div key={inst.id} className="fan-card" style={{ left: step * i, transform: `translateY(${dy}px) rotate(${rot}deg)`, zIndex: i }}>
              <CardView card={cards[inst.cardId]} inst={inst} handlers={bind(inst)} dim={drag?.id === inst.id}
                extra={hideable && (
                  <button className={'hidechip' + (inst.faceDown ? ' on' : '')} title="Verdeckt spielen"
                    aria-pressed={!!inst.faceDown} data-hide={inst.id}
                    onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onHide(inst) }}>
                    {inst.faceDown ? 'Hidden' : 'Hide'}
                  </button>
                )} />
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
  const [mine, setMine] = useState(undefined)     // undefined = lädt, null = noch kein Deck
  const mineRef = useRef(undefined)
  const chRef = useRef(null)
  const [tab, setTab] = useState('play')
  const [modal, setModal] = useState(null)
  const [preview, setPreview] = useState(null)    // { seat, zone, id, cardId }
  const [menu, setMenu] = useState(null)
  const [hover, setHover] = useState(null)        // { id, zone, rect }
  const hoverTimer = useRef(null)
  const lastSecondary = useRef(0)
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
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') { setPreview(null); setHover(null) } }
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
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
      mineRef.current = fixState(row.state?.players?.[mySeat])
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
      return { seat: m.seat, name: m.profiles?.username || 'Spieler', state: fixState(s) }
    })
  const nameOf = (seat) => players.find((p) => p.seat === seat)?.name || '?'
  const stateOf = (seat) => players.find((p) => p.seat === seat)?.state
  const bfSeats = players.filter((p) => p.state?.zones.battlefield.length).map((p) => p.seat)

  // ───────── Hover-Zähler ─────────
  const keepHover = () => clearTimeout(hoverTimer.current)
  const hideHover = () => { clearTimeout(hoverTimer.current); hoverTimer.current = setTimeout(() => setHover(null), 260) }
  const markFns = (iid) => ({
    onCounter: (k, d) => act((p) => changeCounter(p, iid, k, d)),
    onStatus: (k) => act((p) => toggleStatus(p, iid, k)),
    onClear: () => act((p) => clearMarks(p, iid)),
  })

  // ───────── Karten-Interaktion ─────────
  // Linksklick: Vorschau. Rechtsklick oder langes Drücken: Tappen (verdeckte Karte auf dem Tisch: aufdecken). Ziehen: verschieben.
  function openPreview(seat, zone, inst) {
    setHover(null)
    setPreview({ seat, zone, id: inst.id, cardId: inst.cardId })
  }
  function startDrag(inst, zone, card, w, x, y) {
    const allowed = targetsFor(card, zone, bfSeats, inst)
    if (!allowed.length) return false
    dragRef.current = { id: inst.id, allowed, over: null, w }
    setHover(null)
    setDrag({ id: inst.id, card, allowed, over: null, w, x, y })
    return true
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
    if (!own) return { onClick: () => { if (!inst.faceDown) openPreview(seat, zone, inst) } }

    const secondary = () => {
      const now = Date.now()
      if (now - lastSecondary.current < 700) return // Langdruck löst auf manchen Geräten zusätzlich ein Kontextmenü-Ereignis aus
      lastSecondary.current = now
      const cur = findInst(mineRef.current, inst.id)
      if (!cur) return
      if (canReveal(cur.inst, cur.zone)) act((p) => toggleFlag(p, inst.id, 'faceDown'))
      else if (canTap(card, cur.zone)) {
        act((p) => toggleFlag(p, inst.id, 'tapped'))
        navigator.vibrate?.(15)
      }
    }
    const onContextMenu = (e) => { e.preventDefault(); secondary() }
    const onPointerDown = (e) => {
      if (e.button > 0 || e.ctrlKey) return
      const sx = e.clientX
      const sy = e.clientY
      const w = e.currentTarget.getBoundingClientRect().width
      let dragging = false
      let long = false
      let moved = false
      // Langes Drücken gilt nur für Touch/Stift (Maus hat den Rechtsklick), sonst würde langsames Klicken tappen
      const timer = e.pointerType === 'mouse' ? null : setTimeout(() => { long = true; cleanup(); secondary() }, 520)
      const move = (ev) => {
        if (long) return
        if (!dragging) {
          if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 8) return
          moved = true
          clearTimeout(timer)
          if (opts.noDrag) return
          dragging = startDrag(inst, zone, card, w, ev.clientX, ev.clientY)
          if (!dragging) return
          opts.onDragStart?.()
        }
        moveDrag(ev.clientX, ev.clientY)
      }
      const up = (ev) => {
        cleanup(); clearTimeout(timer)
        if (long) return
        if (dragging) endDrag(ev.clientX, ev.clientY)
        else if (!moved) openPreview(seat, zone, inst)
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
    const h = { onPointerDown, onContextMenu }
    if (canMark(card, zone)) {
      h.onPointerEnter = (e) => {
        if (e.pointerType !== 'mouse' || dragRef.current) return
        keepHover()
        const r = e.currentTarget.getBoundingClientRect()
        setHover({ id: inst.id, zone, rect: { left: r.left, right: r.right, top: r.top, bottom: r.bottom } })
      }
      h.onPointerLeave = (e) => { if (e.pointerType === 'mouse') hideHover() }
    }
    return h
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
  const ctx = { cards, settings, mySeat, players, bindCard, onZone, drag }

  const zoneModal = () => {
    const own = modal.seat === mySeat
    const list = stateOf(modal.seat)?.zones[modal.zone] || []
    return (
      <Modal title={`${ZONES[modal.zone]}${own ? '' : ' von ' + nameOf(modal.seat)} · ${list.length}`} onClose={() => setModal(null)}>
        <div className="zone-grid">
          {[...list].reverse().map((inst) => (
            <CardView key={inst.id} card={cards[inst.cardId]} inst={inst} reveal={own} small
              handlers={bindCard(modal.seat, modal.zone, inst, { onDragStart: () => setModal(null) })} />
          ))}
        </div>
        {list.length > 0 && <p className="muted small">Neueste Karte zuerst. Klick vergrößert{own ? ', ziehen verschiebt die Karte (das Fenster schließt sich dabei)' : ''}.</p>}
      </Modal>
    )
  }

  // ───────── Vorschau mit dunklem Hintergrund ─────────
  const previewNode = () => {
    const card = cards[preview.cardId]
    const info = preview.seat === mySeat && mine ? findInst(mine, preview.id) : null
    const zone = info?.zone
    return (
      <div className="modal-bg preview-bg" onClick={() => setPreview(null)}>
        <div className="pv" onClick={(e) => e.stopPropagation()}>
          {card && <img className="big" src={card.image_url} alt={card.name} onClick={() => setPreview(null)} />}
          {info && (
            <div className="pv-bar">
              {canHide(card, zone) && (
                <button className={info.inst.faceDown ? 'primary' : ''} onClick={() => act((p) => toggleFlag(p, preview.id, 'faceDown'))}>
                  Verdeckt spielen: {info.inst.faceDown ? 'an' : 'aus'}
                </button>
              )}
              {canReveal(info.inst, zone) && <button className="primary" onClick={() => act((p) => toggleFlag(p, preview.id, 'faceDown'))}>Aufdecken</button>}
              {canTap(card, zone) && <button onClick={() => act((p) => toggleFlag(p, preview.id, 'tapped'))}>{info.inst.tapped ? 'Enttappen' : 'Tappen'}</button>}
              {canMark(card, zone) && <CounterPanel inst={info.inst} {...markFns(preview.id)} />}
            </div>
          )}
        </div>
      </div>
    )
  }

  const hoverInfo = hover && mine ? findInst(mine, hover.id) : null
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
      {preview && previewNode()}
      {hover && hoverInfo && hoverInfo.zone === hover.zone && !drag && !preview && (
        <Floating rect={hover.rect} onEnter={keepHover} onLeave={hideHover}>
          <CounterPanel inst={hoverInfo.inst} {...markFns(hover.id)} />
        </Floating>
      )}
      {menu && <PopMenu menu={menu} onClose={() => setMenu(null)} />}
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
    setMenu({
      x: r.right - 190, y: r.bottom + 4,
      items: [
        { label: '4 Karten ziehen', run: () => act((p) => draw(p, 4)) },
        { label: 'Rune ziehen', run: () => act((p) => drawRune(p, 1)) },
        { label: 'Deck mischen', run: () => act((p) => shuffleZone(p, 'deck')) },
        { label: 'Runendeck mischen', run: () => act((p) => shuffleZone(p, 'runeDeck')) },
        { label: 'Neues Deck wählen', run: () => { if (confirm('Neues Deck wählen? Dein Spielstand wird zurückgesetzt.')) commit(null) } },
        ...(isHost ? [{ label: 'Optionen', run: () => setModal({ type: 'settings' }) }] : []),
        { label: 'Session verlassen', run: () => go('/') },
      ],
    })
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
              <span className="points">
                <button onClick={() => act((p) => addPoints(p, -1))}>−</button>
                <strong>{mine.points} Punkte</strong>
                <button onClick={() => act((p) => addPoints(p, 1))}>+</button>
              </span>
              <button className="primary" onClick={() => act((p) => draw(p, 1))}>Karte ziehen</button>
              <button onClick={() => act(untapAll)}>Alles enttappen</button>
              <button onClick={openMore}>Mehr ▾</button>
            </div>

            {tab === 'table' ? (
              <Table players={players} mySeat={mySeat} />
            ) : (
              <div className="play-main" style={{ paddingBottom: fanCw * 1.4 + 90 }}>
                <div className="mine-board"><MyBoard players={players} mySeat={mySeat} /></div>
              </div>
            )}
            {tab === 'play' && (
              <HandFan hand={mine.zones.hand} cards={cards} cw={fanCw} drag={drag}
                bind={(inst) => bindCard(mySeat, 'hand', inst)}
                onHide={(inst) => act((p) => toggleFlag(p, inst.id, 'faceDown'))} />
            )}
          </>
         )}
        {overlays}
      </div>
    </GameCtx.Provider>
  )
}
