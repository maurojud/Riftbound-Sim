import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { supabase, loadCards } from './supabase'
import { go } from './nav'
import { Table, MyBoard, CardView, CounterPanel, GameCtx, seatColor } from './Table'
import CardImg, { applyBfRotation, setBfRotation } from './CardImg'
import {
  ZONES, DEFAULT_SETTINGS, buildPlayer, moveCard, toggleFlag, draw, drawRune, shuffleZone, untapAll, addPoints,
  pickBattlefield, pickChampion, targetsFor, canTap, canHide, canReveal, canMark, canAim, canGive, changeCounter, toggleStatus, clearMarks,
  analyzeDeck, fixState, findInst, kindOf, toggleTarget, removeTarget, clearTargets, giveCard, acceptGift, dropGift, takeBackGifts,
  setApproval, resolveEntry, showCards, playToStack, addFx, attachCard, detachCard, changePeek,
  COUNTERS, STATUSES, syncBuffs, FLOAT_CARD, legendDiscount, exhaust, costOf, planPayment, applyPayment, moveAuto, spawnTokens, overlayBattlefield, setPoints, drawBottom, drawRuneBottom,
} from './game'

export const SETTING_LABELS = {
  trashTop: 'Oberste Trash-Karte der anderen sichtbar',
  trashInspect: 'Andere dürfen den ganzen Trash ansehen',
  handCount: 'Anzahl der Handkarten der anderen sichtbar',
  battlefieldRandom: 'Battlefield zufällig zuweisen (gilt für neue Deckwahl)',
}

export const VIEW_ZONES = [
  ['base', 'Base'], ['runes', 'Runen'], ['legend', 'Legend'], ['champion', 'Champion'], ['deck', 'Deck'],
  ['runeDeck', 'Runendeck'], ['hand', 'Hand (Anzahl)'], ['trash', 'Trash'], ['banish', 'Banish'],
]
// Standardmäßig ausgeblendet (Tippen auf „Ansicht anpassen“ blendet sie ein): die Hand liegt unten ohnehin als Fächer
const DEFAULT_HIDDEN = ['deck', 'runeDeck', 'hand', 'runes']
const loadPrefs = () => {
  try { return JSON.parse(localStorage.getItem('rt:view') || '{}') } catch { return {} }
}
const savePrefs = (p) => { try { localStorage.setItem('rt:view', JSON.stringify(p)) } catch { /* ohne Speicher */ } }

const newest = (a, b) => (!a ? b : !b ? a : (a.ts || 0) >= (b.ts || 0) ? a : b)
// Ablagezone unter dem Finger/Zeiger. Nur erlaubte Ziele zählen (so fällt eine Karte über einer anderen Karte auf deren Zone zurück).
// Die Hand-Fläche liegt als Overlay über dem Tisch: sie gewinnt nur im unteren Teil, sonst zählt, was darunter liegt (z. B. Trash).
const zoneAt = (x, y, allowed) => {
  const els = document.elementsFromPoint ? document.elementsFromPoint(x, y) : [document.elementFromPoint(x, y)]
  let hand = null
  for (const el of els) {
    for (let n = el; n && n.dataset; n = n.parentElement) {
      const d = n.dataset.drop
      if (!d || (allowed && !allowed.includes(d))) continue
      if (d === 'hand') {
        const r = n.getBoundingClientRect()
        if (n.classList.contains('fan-drop') ? y > r.top + r.height * 0.45 : false) return 'hand'
        hand = hand || 'hand'
      } else return d
    }
  }
  return hand
}

function Modal({ title, onClose, children }) {
  return (
    <div className="modal-bg top" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h3>{title}</h3><button onClick={onClose}>Schließen</button></div>
        {children}
      </div>
    </div>
  )
}

// Kleines Menü: Mehr, Karten-Optionen (Rechtsklick/langes Drücken), Deck-Optionen und die Frage oben/unten nach dem Ablegen auf ein Deck
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
        {menu.title && <div className="t strong">{menu.title}</div>}
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

// Zielpfeile zwischen Karten (SVG über dem ganzen Tisch). Eigene Pfeile lassen sich per Klick entfernen.
function ArrowLayer({ players, mySeat, onRemove }) {
  const [, setTick] = useState(0)
  const arrows = []
  for (const pl of players) {
    for (const list of Object.values(pl.state?.zones || {})) {
      for (const inst of list) for (const t of inst.targets || []) arrows.push({ from: inst.id, to: t, seat: pl.seat })
    }
    for (const fx of pl.state?.fx || []) for (const t of fx.targets || []) arrows.push({ from: fx.id, to: t, seat: pl.seat })
  }
  const key = arrows.map((a) => a.from + '>' + a.to).join('|')
  useEffect(() => {
    if (!key) return undefined
    const f = () => setTick((t) => t + 1)
    const i = setInterval(f, 250)
    addEventListener('resize', f)
    addEventListener('scroll', f, true)
    return () => { clearInterval(i); removeEventListener('resize', f); removeEventListener('scroll', f, true) }
  }, [key])
  if (!arrows.length) return null
  const rectOf = (id) => {
    const el = [...document.querySelectorAll(`[data-iid="${id}"]`)].find((e) => e.offsetParent !== null || e.getClientRects().length)
    return el ? el.getBoundingClientRect() : null
  }
  const edge = (r, dx, dy) => {
    const sx = dx ? r.width / 2 / Math.abs(dx) : Infinity
    const sy = dy ? r.height / 2 / Math.abs(dy) : Infinity
    return Math.min(sx, sy)
  }
  return (
    <svg className="arrows" width="100%" height="100%">
      {arrows.map((a) => {
        const ra = rectOf(a.from)
        const rb = rectOf(a.to)
        if (!ra || !rb) return null
        const ca = { x: ra.left + ra.width / 2, y: ra.top + ra.height / 2 }
        const cb = { x: rb.left + rb.width / 2, y: rb.top + rb.height / 2 }
        const dx = cb.x - ca.x
        const dy = cb.y - ca.y
        if (!dx && !dy) return null
        const sa = Math.min(1, edge(ra, dx, dy))
        const sb = Math.min(1, edge(rb, dx, dy))
        const p1 = { x: ca.x + dx * sa, y: ca.y + dy * sa }
        const p2 = { x: cb.x - dx * sb, y: cb.y - dy * sb }
        const len = Math.hypot(p2.x - p1.x, p2.y - p1.y)
        if (len < 4) return null
        const ux = (p2.x - p1.x) / len
        const uy = (p2.y - p1.y) / len
        const hs = 13
        const b1 = { x: p2.x - ux * hs + uy * hs * 0.5, y: p2.y - uy * hs - ux * hs * 0.5 }
        const b2 = { x: p2.x - ux * hs - uy * hs * 0.5, y: p2.y - uy * hs + ux * hs * 0.5 }
        const col = seatColor(a.seat)
        const mine = a.seat === mySeat
        return (
          <g key={a.from + '>' + a.to} className={'arrow' + (mine ? ' mine' : '')} onClick={mine ? () => onRemove(a.from, a.to) : undefined}>
            <title>{mine ? 'Klicken, um den Pfeil zu entfernen' : 'Zielpfeil'}</title>
            <line x1={p1.x} y1={p1.y} x2={p2.x - ux * 4} y2={p2.y - uy * 4} stroke="#000" strokeOpacity=".45" strokeWidth="7" strokeLinecap="round" />
            <line x1={p1.x} y1={p1.y} x2={p2.x - ux * 4} y2={p2.y - uy * 4} stroke={col} strokeWidth="4" strokeLinecap="round" />
            <polygon points={`${p2.x},${p2.y} ${b1.x},${b1.y} ${b2.x},${b2.y}`} fill={col} stroke="#000" strokeOpacity=".45" strokeWidth="1.5" />
            {mine && <line className="hit" x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="transparent" strokeWidth="22" />}
          </g>
        )
      })}
    </svg>
  )
}

// Oberste Karten von Deck oder Runendeck ansehen: pro Karte oben/unten legen, in die Hand nehmen oder kurz allen zeigen
function LookModal({ zone, mine, cards, act, onClose }) {
  const list = mine.zones[zone]
  const [n, setN] = useState(Math.min(3, list.length) || 1)
  const [ids, setIds] = useState(() => list.slice(0, n).map((i) => i.id))
  const [done, setDone] = useState([])
  const change = (d) => {
    const nn = Math.max(1, Math.min(list.length || 1, n + d))
    setN(nn); setIds(list.slice(0, nn).map((i) => i.id)); setDone([])
  }
  const cur = ids.filter((id) => !done.includes(id)).map((id) => list.find((i) => i.id === id)).filter(Boolean)
  const rune = zone === 'runeDeck'
  const mv = (id, to) => { act((p) => moveCard(p, id, to)); setDone((d) => [...d, id]) }
  return (
    <Modal title={`${rune ? 'Runendeck' : 'Deck'}: oberste Karten`} onClose={onClose}>
      <div className="row look-n">
        <span>Anzahl</span>
        <button onClick={() => change(-1)} aria-label="weniger">−</button><b>{n}</b><button onClick={() => change(1)} aria-label="mehr">+</button>
        <span className="muted small">{list.length} Karten im Stapel</span>
      </div>
      {cur.length === 0 && <p className="muted">Keine Karten mehr in dieser Auswahl.</p>}
      <div className="look-list">
        {cur.map((inst, i) => (
          <div key={inst.id} className="look-item">
            <span className="muted small">{i === 0 ? 'oberste' : `${i + 1}.`}</span>
            <CardView card={cards[inst.cardId]} inst={inst} small />
            <div className="look-btns">
              <button onClick={() => mv(inst.id, rune ? 'runeDeckTop' : 'deckTop')}>Oben</button>
              <button onClick={() => mv(inst.id, rune ? 'runeDeckBottom' : 'deckBottom')}>Unten</button>
              <button onClick={() => mv(inst.id, rune ? 'runes' : 'hand')}>{rune ? 'Runenzone' : 'Hand'}</button>
              {!rune && <button onClick={() => mv(inst.id, 'trash')}>Trash</button>}
              <button className="ghostbtn" onClick={() => act((p) => showCards(p, [inst.cardId]))}>Allen zeigen</button>
            </div>
          </div>
        ))}
      </div>
      <p className="muted small">„Oben“ legt die Karte zurück auf den Stapel. Die zuletzt gelegte Karte liegt ganz oben.</p>
    </Modal>
  )
}

function ViewModal({ prefs, setPrefs, rot, setRot, onClose }) {
  const set = (who, k, v) => setPrefs((p) => { const n = { ...p, [who]: { ...(p[who] || {}), [k]: v } }; savePrefs(n); return n })
  const val = (who, k) => prefs[who]?.[k] ?? (who === 'mine' && !DEFAULT_HIDDEN.includes(k))
  return (
    <Modal title="Ansicht anpassen" onClose={onClose}>
      <p className="muted small">Gilt nur für dich, im Reiter „Mein Spiel“. Der Fernseher und „Ganzer Tisch“ zeigen immer alles.</p>
      <div className="view-cols">
        <div className="stack">
          <h4>Meine Zonen</h4>
          {VIEW_ZONES.map(([k, label]) => (
            <label key={k} className="check"><input type="checkbox" checked={val('mine', k)} onChange={(e) => set('mine', k, e.target.checked)} />{label}</label>
          ))}
        </div>
        <div className="stack">
          <h4>Zonen der Gegner</h4>
          {VIEW_ZONES.map(([k, label]) => (
            <label key={k} className="check"><input type="checkbox" checked={val('opp', k)} onChange={(e) => set('opp', k, e.target.checked)} />{label}</label>
          ))}
        </div>
      </div>
      <hr />
      <label className="check">
        <input type="checkbox" checked={rot === '-90'} onChange={(e) => setRot(setBfRotation(e.target.checked ? '-90' : '90'))} />
        Battlefield-Bilder andersherum drehen (falls sie auf dem Kopf stehen)
      </label>
    </Modal>
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

// Handkarten als Fächer. Jede Karte hat einen "Hide"-Schalter: verdeckt gespielte Karten sieht der Gegner nicht.
// Rückfrage bei Karten mit zwei Power-Farben: welche Runen sollen recycelt werden?
function PayModal({ ask, cards, mine, onCancel, onFree, onPay }) {
  const [picked, setPicked] = useState([])
  const runes = ask.choice.candidates.map((id) => mine.zones.runes.find((r) => r.id === id)).filter(Boolean)
  const toggle = (id) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length < ask.choice.n ? [...cur, id] : cur))
  return (
    <Modal title={`„${ask.name}“ bezahlen`} onClose={onCancel}>
      <p>Wähle {ask.choice.n} {ask.choice.n === 1 ? 'Rune' : 'Runen'} ({ask.cost.colors.join(' oder ')}) zum Recyceln. Sie kommen unter das Runendeck.
        {ask.cost.energy > 0 && ` Zusätzlich werden ${ask.cost.energy} Runen für die Energy getappt.`}</p>
      <div className="zone-grid paygrid">
        {runes.map((r) => (
          <button key={r.id} className={'paypick' + (picked.includes(r.id) ? ' on' : '')} aria-pressed={picked.includes(r.id)} onClick={() => toggle(r.id)}>
            <CardImg src={cards[r.cardId]?.image_url} alt={cards[r.cardId]?.name} />
            <span>{cards[r.cardId]?.color}{r.tapped ? ' · getappt' : ''}</span>
          </button>
        ))}
      </div>
      <div className="row">
        <button className="primary" disabled={picked.length !== ask.choice.n} onClick={() => onPay(picked)}>Bezahlen und spielen ({picked.length}/{ask.choice.n})</button>
        <button onClick={onFree}>Ohne Bezahlen spielen</button>
        <button onClick={onCancel}>Abbrechen</button>
      </div>
    </Modal>
  )
}


// Übersicht aller Ziele, solange ein Pfeil/Spielen/Effekt gewählt wird: nach Besitzer und Zone gelistet, mit Status. So muss man nicht den ganzen Tisch einblenden.
function AimPanel({ players, cards, bfSeats, aimId, mySeat, onPick, onClose }) {
  const chipsOf = (inst) => {
    const out = []
    if (inst.tapped) out.push('getappt')
    if (inst.faceDown) out.push('verdeckt')
    const c = inst.counters || {}
    COUNTERS.forEach((d) => { if (c[d.key]) out.push(`${d.label} ${d.signed && c[d.key] > 0 ? '+' : ''}${c[d.key]}`) })
    const st = inst.status || {}
    STATUSES.forEach((d) => { if (st[d.key]) out.push(d.label) })
    if (inst.token) out.push('Token')
    return out
  }
  const bfInst = (key) => {
    if (typeof key === 'number') { const pl = players.find((p) => p.seat === key); return pl?.state?.zones.battlefield[0] }
    return players.flatMap((p) => p.state?.zones.bfExtra || []).find((i) => 'x' + i.id === key)
  }
  const sections = []
  for (const key of bfSeats) {
    const b = bfInst(key)
    if (!b) continue
    const items = [{ inst: b, owner: null, label: 'Battlefield' }]
    for (const pl of players) for (const u of pl.state?.zones.bfUnits || []) if (String(u.at) === String(key)) items.push({ inst: u, owner: pl, label: 'Battlefield' })
    sections.push({ key: 'bf' + key, title: `Battlefield: ${cards[b.cardId]?.name || '?'}`, items })
  }
  for (const pl of players) {
    if (!pl.state) continue
    const z = pl.state.zones
    for (const [zone, label] of [['base', 'Base'], ['champion', 'Champion'], ['legend', 'Legend'], ['stack', 'Stack']]) {
      if (z[zone]?.length) sections.push({ key: pl.seat + zone, title: `${pl.name} · ${label}`, seat: pl.seat, items: z[zone].map((inst) => ({ inst, owner: pl, label })) })
    }
  }
  return (
    <div className="aimpanel" role="region" aria-label="Ziele">
      <div className="aimpanel-head"><b>Ziele auswählen</b><button onClick={onClose}>Übersicht ausblenden</button></div>
      {sections.length === 0 && <p className="muted">Keine Ziele im Spiel.</p>}
      {sections.map((sec) => (
        <div key={sec.key} className="aimsec">
          <h4 style={sec.seat ? { color: seatColor(sec.seat) } : undefined}>{sec.title}</h4>
          <div className="aimtiles">
            {sec.items.filter((x) => x.inst.id !== aimId).map(({ inst, owner, label }) => {
              const card = cards[inst.cardId]
              const hidden = !card || (inst.faceDown && owner && owner.seat !== mySeat)
              const chips = chipsOf(inst)
              return (
                <button key={inst.id} className={'aimtile' + (inst.tapped ? ' tapped' : '')} onClick={() => onPick(inst.id)} data-aimtarget={inst.id}>
                  <span className="aimimg">{hidden || !card ? <span className="back" /> : <CardImg src={card.image_url} alt={card.name} battlefield={kindOf(card) === 'battlefield'} />}</span>
                  <b>{hidden ? 'Verdeckte Karte' : card.name}</b>
                  <span className="aimmeta">{owner ? `${owner.name} · ` : ''}{label}</span>
                  {chips.length > 0 && <span className="aimchips">{chips.map((c) => <i key={c}>{c}</i>)}</span>}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// Dauerhafte Token-Auswahl: jede Token-Karte der Datenbank, beliebig oft spielbar
const TOKEN_ORDER = ['Unit', 'Gear', 'Spell', 'Battlefield', 'Other']
function TokenModal({ tokens, onSpawn, onClose }) {
  const [n, setN] = useState({})
  const cnt = (id) => n[id] || 1
  const typeOf = (c) => TOKEN_ORDER.find((t) => t.toLowerCase() === String(c.token_type || '').toLowerCase()) || 'Ohne Typ'
  const groups = [...TOKEN_ORDER, 'Ohne Typ'].map((t) => [t, tokens.filter((c) => typeOf(c) === t)]).filter(([, l]) => l.length)
  return (
    <Modal title="Tokens spielen" onClose={onClose} top>
      {tokens.length === 0 && <p className="muted">Noch keine Token-Karten vorhanden. Im Karten-Verwalter die Art „Token“ setzen.</p>}
      {groups.map(([type, list]) => (
        <section key={type}>
          <h4 className="grouptitle">{type === 'Unit' ? 'Units' : type === 'Gear' ? 'Gear' : type === 'Spell' ? 'Spells' : type === 'Battlefield' ? 'Battlefields' : type}</h4>
          <div className="tokengrid">
            {list.map((c) => (
              <div key={c.id} className="tokentile">
                <button className="tokenimg" title="Klick spielt 1 Token" onClick={() => onSpawn(c, 1)}>
                  <CardImg src={c.image_url} alt={c.name} battlefield={type === 'Battlefield'} />
                </button>
                <b title={c.name}>{c.name}</b>
                <div className="row tokenctl">
                  <button aria-label="weniger" onClick={() => setN((cur) => ({ ...cur, [c.id]: Math.max(1, (cur[c.id] || 1) - 1) }))}>−</button>
                  <span>{cnt(c.id)}</span>
                  <button aria-label="mehr" onClick={() => setN((cur) => ({ ...cur, [c.id]: Math.min(20, (cur[c.id] || 1) + 1) }))}>+</button>
                  <button className="primary" onClick={() => onSpawn(c, cnt(c.id))}>{cnt(c.id)}× spielen</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
      <p className="muted small">Tokens landen im Base und verhalten sich wie normale Karten. Verlassen sie das Spielfeld, verschwinden sie. Battlefield-Token mit dem Modus „überlegen“ ziehst du auf das gewünschte Battlefield.</p>
    </Modal>
  )
}

export function HandFan({ hand, cards, cw, bind, drag, onHide, onPlay }) {
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
      data-drop="hand" style={{ '--cw': cw + 'px', height: cw * 1.12 + 48 }}>
      <div className="fan-drop" data-drop="hand" />
      {n === 0 && <span className="muted fan-empty">Keine Handkarten. Klicke auf dein Deck, um zu ziehen.</span>}
      <div className="fan-inner" style={{ width: total }}>
        {hand.map((inst, i) => {
          const off = i - mid
          const rot = off * (n > 6 ? 2.2 : 3.5)
          const dy = off * off * (n > 6 ? 0.9 : 2.5)
          const hideable = canHide(cards[inst.cardId], 'hand')
          return (
            <div key={inst.id} className="fan-card" style={{ left: step * i, transform: `translateY(${dy}px) rotate(${rot}deg)`, zIndex: i }}>
              <CardView card={cards[inst.cardId]} inst={inst} handlers={bind(inst)} dim={drag?.id === inst.id}
                onChip={hideable ? () => onPlay(inst) : undefined} chipAttr={{ 'data-play': inst.id }} chipTitle="Spielen: Ziel wählen, die Karte kommt auf den Stack"
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
  const lastPtype = useRef('mouse')
  const [drag, setDrag] = useState(null)
  const dragRef = useRef(null)
  const ghostRef = useRef(null)
  const [aimOpen, setAimOpen] = useState(true)
  const [aim, setAimRaw] = useState(null)            // { id, mode } – Karte, für die gerade ein Ziel gewählt wird (arrow, play, fx)
  const setAim = (v) => { if (v) setAimOpen(true); setAimRaw(v) }
  const [showing, setShowing] = useState(null)    // kurz gezeigte Karten eines Mitspielers
  const seenShown = useRef({})
  const [prefs, setPrefs] = useState(loadPrefs)
  const [rot, setRot] = useState(() => applyBfRotation())
  const [err, setErr] = useState('')
  const [vw, setVw] = useState(window.innerWidth)
  const [auto, setAutoState] = useState(() => { try { return { pay: true, exhaust: true, ...JSON.parse(localStorage.getItem('rt:auto')) } } catch { return { pay: true, exhaust: true } } })
  const setAuto = (patch) => setAutoState((a) => { const n = { ...a, ...patch }; try { localStorage.setItem('rt:auto', JSON.stringify(n)) } catch { /* egal */ } return n })
  const [payAsk, setPayAsk] = useState(null)      // Rückfrage: welche Runen sollen für Power recycelt werden?
  const [notice, setNotice] = useState('')
  const noticeT = useRef(null)
  const say = (t) => { setNotice(t); clearTimeout(noticeT.current); noticeT.current = setTimeout(() => setNotice(''), 5000) }

  useEffect(() => {
    const f = () => setVw(window.innerWidth)
    addEventListener('resize', f)
    return () => removeEventListener('resize', f)
  }, [])
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') { setPreview(null); setHover(null); setAim(null); setMenu(null) } }
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
    const put = (list) => setCards({ ...Object.fromEntries((list || []).map((c) => [c.id, c])), [FLOAT_CARD.id]: FLOAT_CARD })
    let dead = false
    loadCards((list) => { if (!dead) put(list) }).then(({ cached }) => { if (cached && !dead) put(cached) })
    let connected = false
    const ch = supabase
      .channel(`table-${id}`, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'seat' }, ({ payload }) => setLive((l) => ({ ...l, [payload.seat]: payload.state })))
      .on('broadcast', { event: 'settings' }, ({ payload }) => setRow((r) => r && { ...r, settings: payload }))
      .on('broadcast', { event: 'ping' }, () => { loadRow(); loadMembers() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions', filter: `id=eq.${id}` }, (p) => p.new && setRow((r) => ({ ...(r || {}), ...p.new })))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'session_members', filter: `session_id=eq.${id}` }, loadMembers)
      .subscribe((status) => {
        connected = status === 'SUBSCRIBED'
        if (connected) ch.send({ type: 'broadcast', event: 'ping', payload: {} })
      })
    chRef.current = ch
    // Notfall-Auffrischung: ohne Live-Verbindung alle 3 s, mit Live-Verbindung nur alle 15 s; im Hintergrund-Tab gar nicht
    let n = 0
    const t = setInterval(() => { n++; if (!document.hidden && (!connected || n % 5 === 0)) { loadRow(); loadMembers() } }, 3000)
    return () => { dead = true; clearInterval(t); chRef.current = null; supabase.removeChannel(ch) }
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
  // Buff-Tokens auf Einheiten zählen automatisch den Buff-Zähler mit
  useEffect(() => {
    if (!mineRef.current || !Object.keys(cards).length) return
    const n = syncBuffs(mineRef.current, cards)
    if (n !== mineRef.current) commit(n)
  }, [mine, cards]) // eslint-disable-line

  const players = members
    .filter((m) => m.seat)
    .sort((a, b) => a.seat - b.seat)
    .map((m) => {
      const s = m.seat === mySeat ? mine : newest(live[m.seat], row?.state?.players?.[m.seat])
      return { seat: m.seat, name: m.profiles?.username || 'Spieler', state: fixState(s) }
    })
  const nameOf = (seat) => players.find((p) => p.seat === seat)?.name || '?'
  const stateOf = (seat) => players.find((p) => p.seat === seat)?.state
  const bfSeats = [
    ...players.filter((p) => p.state?.zones.battlefield.length).map((p) => p.seat),
    ...players.flatMap((p) => (p.state?.zones.bfExtra || []).filter((i) => !i.ovr).map((i) => 'x' + i.id)),
  ]

  // ───────── Übergaben: Karten, die Mitspieler mir gegeben haben, übernehmen; eigene erledigte Übergaben aufräumen ─────────
  const giftKey = players.map((p) => p.seat + ':' + (p.state?.outbox || []).map((g) => `${g.inst.id}>${g.to}`).join(',')).join(';')
    + '|' + (mine?.outbox || []).map((g) => g.inst.id + (stateOf(g.to) && findInst(stateOf(g.to), g.inst.id) ? '+' : '-')).join(',')
  useEffect(() => {
    if (!mySeat || !mineRef.current) return
    let next = mineRef.current
    let changed = false
    for (const pl of players) {
      if (pl.seat === mySeat) continue
      for (const g of pl.state?.outbox || []) {
        if (g.to === mySeat && !findInst(next, g.inst.id)) { next = acceptGift(next, g); changed = true }
      }
    }
    for (const g of next.outbox || []) {
      const rs = stateOf(g.to)
      if (rs && findInst(rs, g.inst.id)) { next = dropGift(next, g.inst.id); changed = true }
    }
    if (changed) commit(next)
  }, [giftKey]) // eslint-disable-line

  // ───────── Aufräumen: Einheiten auf einem verschwundenen Zusatz-Battlefield kehren ins Base zurück, Overlays ohne Battlefield verschwinden ─────────
  const bfKeyNow = bfSeats.map(String)
  const orphans = mine ? [
    ...mine.zones.bfUnits.filter((i) => typeof i.at === 'string' && !bfKeyNow.includes(i.at)).map((i) => ['u', i.id]),
    ...(mine.zones.bfExtra || []).filter((i) => i.ovr && !bfKeyNow.includes(i.ovr)).map((i) => ['o', i.id]),
  ] : []
  const orphanKey = players.every((p) => p.state) ? orphans.map((o) => o.join(':')).join(',') : ''
  useEffect(() => {
    if (!orphanKey || !mineRef.current) return
    let next = mineRef.current
    for (const [kind, id] of orphans) next = moveCard(next, id, kind === 'u' ? 'base' : 'trash')
    commit(next)
  }, [orphanKey]) // eslint-disable-line

  // ───────── Kurz gezeigte Karten (z. B. beim Ansehen der obersten Deckkarten) ─────────
  useEffect(() => {
    for (const pl of players) {
      const sh = pl.state?.shown
      if (!sh || seenShown.current[pl.seat] === sh.at) continue
      const first = seenShown.current[pl.seat] === undefined
      seenShown.current[pl.seat] = sh.at
      if (first && Date.now() - sh.at > 15000) continue
      if (pl.seat === mySeat) continue
      setShowing({ name: pl.name, cardIds: sh.cardIds, at: sh.at })
      const t = setTimeout(() => setShowing((cur) => (cur && cur.at === sh.at ? null : cur)), 6000)
      return () => clearTimeout(t)
    }
    return undefined
  }, [players.map((p) => p.state?.shown?.at || 0).join(',')]) // eslint-disable-line

  // ───────── Hover-Zähler ─────────
  const keepHover = () => clearTimeout(hoverTimer.current)
  const hideHover = () => { clearTimeout(hoverTimer.current); hoverTimer.current = setTimeout(() => setHover(null), 260) }
  const markFns = (iid) => ({
    onCounter: (k, d) => act((p) => changeCounter(p, iid, k, d)),
    onStatus: (k) => act((p) => toggleStatus(p, iid, k)),
    onClear: () => act((p) => clearMarks(p, iid)),
  })

  // ───────── Karten-Interaktion ─────────
  // Maus: Linksklick = Vorschau, Rechtsklick = Tappen (verdeckte Karte: aufdecken), Ziehen = verschieben.
  // Touch/Stift: kurzes Tippen = Tappen (verdeckt: aufdecken), langes Drücken = Optionen. Wo es nichts zu tappen gibt, vergrößert das Tippen.
  function openPreview(seat, zone, inst) {
    setHover(null)
    setPreview({ seat, zone, id: inst.id, cardId: inst.cardId })
  }
  function startDrag(inst, zone, card, w, x, y) {
    const hostIds = ['base', 'bfUnits'].flatMap((z) => (mineRef.current?.zones[z] || []).filter((i) => !i.att).map((i) => i.id))
    const allowed = targetsFor(card, zone, bfSeats, inst, hostIds)
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
    const over = zoneAt(x, y, d.allowed)
    if (over !== d.over) { d.over = over; setDrag((s) => s && { ...s, over }) }
  }
  function endDrag(x, y) {
    const d = dragRef.current
    dragRef.current = null
    setDrag(null)
    const over = zoneAt(x, y, d?.allowed)
    if (!d || !over || !d.allowed.includes(over)) return
    if (over.startsWith('card:')) { act((p) => attachCard(p, d.id, over.slice(5))); return }
    if (over.startsWith('bfov:')) { act((p) => overlayBattlefield(p, d.id, over.slice(5))); return }
    if (over === 'deck' || over === 'runeDeck') {
      // oben oder unten wird erst nach dem Loslassen gefragt
      const rune = over === 'runeDeck'
      setMenu({
        x, y, title: rune ? 'Auf das Runendeck legen' : 'Auf das Deck legen',
        items: [
          { label: 'Oben drauf', run: () => act((p) => moveCard(p, d.id, rune ? 'runeDeckTop' : 'deckTop')) },
          { label: 'Ganz unten', run: () => act((p) => moveCard(p, d.id, rune ? 'runeDeckBottom' : 'deckBottom')) },
        ],
      })
      return
    }
    payThen(d.id, over, (p) => moveAuto(p, d.id, over, cards, auto))
  }
  useEffect(() => {
    if (drag && ghostRef.current) ghostRef.current.style.transform = `translate(${drag.x - drag.w / 2}px, ${drag.y - drag.w * 0.7}px)`
  }, [drag?.id]) // eslint-disable-line

  // Karte aus Hand/Champion-Zone ins Spiel: Kosten automatisch mit Runen bezahlen (Energy = tappen, Power = recyceln), danach die Aktion ausführen
  function payThen(instId, to, run) {
    const cur = findInst(mineRef.current, instId)
    const card = cur && cards[cur.inst.cardId]
    const play = !!cur && ['hand', 'champion'].includes(cur.zone) && (to === 'stack' || to === 'base' || to.startsWith('bf:')) && !cur.inst.faceDown && !cur.inst.token
    if (!play || !auto.pay) return act(run)
    let cost = costOf(card)
    let saved = null
    if (cost && auto.legend !== false) {
      const legendInst = mineRef.current.zones.legend[0]
      ;({ cost, saved } = legendDiscount(cards[legendInst?.cardId], card, cost))
      if (saved) {
        if (saved.tap && legendInst.tapped) { // bereits getappte Legend kann nicht noch einmal bezahlen
          cost = costOf(card); saved = null
          say('Die Legend ist schon getappt und übernimmt deshalb keine Kosten.')
        } else saved = { ...saved, legendId: legendInst.id }
      }
    }
    if (!cost) {
      if (card && !['rune', 'legend', 'battlefield'].includes(kindOf(card))) say(`Kosten von „${card.name}“ sind nicht hinterlegt, deshalb nicht automatisch bezahlt.`)
      return act(run)
    }
    const plan = planPayment(mineRef.current, cost, cards)
    if (plan.choice) return setPayAsk({ cost, choice: plan.choice, run, name: card.name, saved })
    return finishPay(plan, run, card.name, saved)
  }
  function finishPay(plan, run, name, saved) {
    act((p) => { const n = run(applyPayment(p, plan)); return saved?.tap && saved.legendId ? exhaust(n, saved.legendId) : n })
    const msgs = []
    if (saved) msgs.push(`Die Legend übernimmt ${[saved.energy && `${saved.energy} Energy`, saved.power && `${saved.power} Power`].filter(Boolean).join(' und ')}${saved.tap ? ' und wird getappt' : ''}.`)
    if (plan.floats > 0) msgs.push(`Es gab zu wenige getappte Runen in der richtigen Farbe: ${plan.floats} bereite Rune${plan.floats > 1 ? 'n' : ''} wurde${plan.floats > 1 ? 'n' : ''} recycelt. Dafür liegt ${plan.floats} Floating Energy in deiner Runenzone.`)
    if (plan.floatUsed > 0) msgs.push(`${plan.floatUsed} Floating Energy aus dem Recyceln hat gleich Energy bezahlt.`)
    if (msgs.length) say(`„${name}“: ${msgs.join(' ')}`)
    const miss = []
    if (plan.missingEnergy > 0) miss.push(`${plan.missingEnergy} Energy`)
    if (plan.missingPower > 0) miss.push(`${plan.missingPower} Power`)
    if (miss.length) say(`„${name}“: Es fehlten ${miss.join(' und ')} (zu wenige passende Runen). Gespielt wurde trotzdem.${msgs.length ? ' ' + msgs.join(' ') : ''}`)
  }

  // Alles, was man mit einer eigenen Karte tun kann (für Menü, Vorschau und Hover-Feld)
  function actionsFor(iid) {
    const cur = findInst(mineRef.current, iid)
    if (!cur) return []
    const { zone, inst } = cur
    const card = cards[inst.cardId]
    const items = [{ key: 'view', label: 'Vergrößern', run: () => openPreview(mySeat, zone, inst) }]
    if (canReveal(inst, zone)) items.push({ key: 'reveal', label: 'Aufdecken', run: () => act((p) => toggleFlag(p, iid, 'faceDown')) })
    if (canTap(card, zone)) items.push({ key: 'tap', label: inst.tapped ? 'Enttappen' : 'Tappen', run: () => act((p) => toggleFlag(p, iid, 'tapped')) })
    if (canHide(card, zone)) items.push({ key: 'hide', label: inst.faceDown ? 'Nicht mehr verdeckt spielen' : 'Verdeckt spielen', run: () => act((p) => toggleFlag(p, iid, 'faceDown')) })
    if (canMark(card, zone)) items.push({ key: 'marks', label: 'Zähler & Status', run: () => openPreview(mySeat, zone, inst) })
    if (inst.att) {
      items.push({ key: 'detach', label: 'Von der Karte lösen', run: () => act((p) => detachCard(p, iid)) })
      items.push({ key: 'peekup', label: 'Mehr davon sichtbar', run: () => act((p) => changePeek(p, iid, 0.04)) })
      items.push({ key: 'peekdown', label: 'Weniger davon sichtbar', run: () => act((p) => changePeek(p, iid, -0.04)) })
    }
    if (['base', 'bfUnits', 'champion', 'legend'].includes(zone)) {
      items.push({ key: 'fx', label: 'Effekt auf den Stack…', run: () => { setPreview(null); setHover(null); setAim({ id: iid, mode: 'fx' }) } })
    }
    if (canAim(zone)) {
      items.push({ key: 'aim', label: '➚ Pfeil ohne Stack', run: () => { setPreview(null); setHover(null); setAim({ id: iid, mode: 'arrow' }) } })
      if (inst.targets?.length) items.push({ key: 'unaim', label: 'Pfeile entfernen', run: () => act((p) => clearTargets(p, iid)) })
    }
    if (inst.floating) items.push({ key: 'remove', label: 'Floating Energy entfernen', run: () => act((p) => moveCard(p, iid, 'trash')) })
    if (zone === 'bfExtra') items.push({ key: 'remove', label: 'Battlefield-Token entfernen', run: () => act((p) => moveCard(p, iid, 'trash')) })
    if (canGive(card, zone)) {
      for (const pl of players) {
        if (pl.seat !== mySeat) items.push({ key: 'give', label: `An ${pl.name} geben`, run: () => { setPreview(null); setHover(null); act((p) => giveCard(p, iid, pl.seat)) } })
      }
    }
    return items
  }
  function pickTarget(targetId) {
    const cur = aim
    setAim(null)
    if (!cur || cur.id === targetId) return
    if (cur.mode === 'arrow') act((p) => toggleTarget(p, cur.id, targetId))
    else if (cur.mode === 'play') payThen(cur.id, 'stack', (p) => playToStack(p, cur.id, targetId, cards, auto))
    else act((p) => addFx(p, cur.id, targetId))
  }
  function noTarget() {
    const cur = aim
    setAim(null)
    if (!cur) return
    if (cur.mode === 'play') payThen(cur.id, 'stack', (p) => playToStack(p, cur.id, null, cards, auto))
    else if (cur.mode === 'fx') act((p) => addFx(p, cur.id, null))
  }

  function bindCard(seat, zone, inst, opts = {}) {
    const card = cards[inst.cardId]
    const own = seat === mySeat
    if (aim) {
      if (zone === 'hand' || zone === 'runes') return {}
      return { onClick: () => pickTarget(inst.id), onContextMenu: (e) => e.preventDefault() }
    }
    if (!own) return { onClick: () => { if (!inst.faceDown) openPreview(seat, zone, inst) } }

    // zweite Aktion: Tappen bzw. Aufdecken
    const secondary = () => {
      const now = Date.now()
      if (now - lastSecondary.current < 700) return
      lastSecondary.current = now
      const cur = findInst(mineRef.current, inst.id)
      if (!cur) return false
      if (canReveal(cur.inst, cur.zone)) { act((p) => toggleFlag(p, inst.id, 'faceDown')); return true }
      if (canTap(card, cur.zone)) {
        act((p) => toggleFlag(p, inst.id, 'tapped'))
        navigator.vibrate?.(15)
        return true
      }
      return false
    }
    const quick = (ptype) => {
      if (ptype === 'mouse') return openPreview(seat, zone, inst)
      const cur = findInst(mineRef.current, inst.id)
      if (cur && (canReveal(cur.inst, cur.zone) || canTap(card, cur.zone))) secondary()
      else openPreview(seat, zone, inst)
    }
    const openMenu = (x, y) => {
      const items = actionsFor(inst.id)
      if (!items.length) return
      navigator.vibrate?.(20)
      setMenu({ x, y, items, title: card?.name })
    }
    const onContextMenu = (e) => {
      e.preventDefault()
      if (lastPtype.current === 'mouse') secondary() // bei Touch kommt das lange Drücken über den Timer
    }
    const onPointerDown = (e) => {
      if (e.button > 0 || e.ctrlKey) return
      lastPtype.current = e.pointerType
      const ptype = e.pointerType
      const sx = e.clientX
      const sy = e.clientY
      const w = e.currentTarget.getBoundingClientRect().width
      let dragging = false
      let long = false
      let moved = false
      const timer = ptype === 'mouse' ? null : setTimeout(() => { long = true; cleanup(); navigator.vibrate?.(20); openPreview(seat, zone, inst) }, 520) // langes Drücken = große Ansicht mit allen Optionen
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
        else if (!moved) quick(ptype)
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
    if (canMark(card, zone) || canAim(zone) || canGive(card, zone)) {
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

  // ───────── Stapel: Linksklick/Tippen = Aktion, Rechtsklick/langes Drücken = Menü ─────────
  function onZone(seat, zone) {
    if (seat === mySeat) {
      if (zone === 'deck') return act((p) => draw(p, 1))
      if (zone === 'runeDeck') return act((p) => drawRune(p, 1))
      if (zone === 'trash' || zone === 'banish') setModal({ type: 'zone', zone, seat })
      return undefined
    }
    if (zone === 'banish' || (zone === 'trash' && settings.trashInspect)) setModal({ type: 'zone', zone, seat })
    return undefined
  }
  function pileMenu(zone) {
    if (zone === 'deck') {
      return [
        { label: 'Mischen', run: () => act((p) => shuffleZone(p, 'deck')) },
        { label: 'Oberste Karten ansehen…', run: () => setModal({ type: 'look', zone: 'deck' }) },
        { label: 'Unterste Karte ziehen', run: () => act((p) => drawBottom(p)) },
        { label: '4 Karten ziehen', run: () => act((p) => draw(p, 4)) },
      ]
    }
    if (zone === 'runeDeck') {
      return [
        { label: 'Mischen', run: () => act((p) => shuffleZone(p, 'runeDeck')) },
        { label: 'Oberste Karten ansehen…', run: () => setModal({ type: 'look', zone: 'runeDeck' }) },
        { label: 'Unterste Rune ziehen', run: () => act((p) => drawRuneBottom(p)) },
      ]
    }
    return null
  }
  function bindPile(seat, zone) {
    if (seat !== mySeat) return { onClick: () => onZone(seat, zone) }
    const items = pileMenu(zone)
    const openMenu = (x, y) => {
      if (!items) return
      navigator.vibrate?.(20)
      setMenu({ x, y, items, title: zone === 'deck' ? 'Deck' : 'Runendeck' })
    }
    return {
      onClick: (e) => { if (e.detail === 0) onZone(seat, zone) }, // Tastatur
      onContextMenu: (e) => { e.preventDefault(); if (lastPtype.current === 'mouse') openMenu(e.clientX, e.clientY) },
      onPointerDown: (e) => {
        if (e.button > 0) return
        lastPtype.current = e.pointerType
        const sx = e.clientX
        const sy = e.clientY
        let long = false
        let moved = false
        const timer = e.pointerType === 'mouse' || !items ? null : setTimeout(() => { long = true; cleanup(); openMenu(sx, sy) }, 520)
        const move = (ev) => { if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 10) { moved = true; clearTimeout(timer) } }
        const up = () => { cleanup(); clearTimeout(timer); if (!long && !moved) onZone(seat, zone) }
        const cancel = () => { cleanup(); clearTimeout(timer) }
        function cleanup() {
          removeEventListener('pointermove', move)
          removeEventListener('pointerup', up)
          removeEventListener('pointercancel', cancel)
        }
        addEventListener('pointermove', move)
        addEventListener('pointerup', up)
        addEventListener('pointercancel', cancel)
      },
    }
  }

  if (err && !row) return <div className="center"><p className="error">{err}</p><button onClick={() => go('/')}>Zurück</button></div>
  if (!row) return <div className="center">Lade Session…</div>

  const pw = sessionStorage.getItem('pw:' + id)
  const joinUrl = `${location.origin}${location.pathname}#/join/${row.code}`
  const ctx = {
    onAim: (iid) => { setPreview(null); setHover(null); setAim({ id: iid, mode: 'arrow' }) },
    cards, settings, mySeat, players, bindCard, bindPile, onZone, drag, aim: aim?.id || null, pickTarget,
    onApprove: (sig, on) => act((p) => setApproval(p, sig, on)),
    onResolve: (entry) => act((p) => resolveEntry(p, entry)),
    onRemoveFx: (fxId) => act((p) => resolveEntry(p, { fx: { id: fxId } })),
    onPoints: (d) => act((p) => addPoints(p, d)),
    onSetPoints: (n) => act((p) => setPoints(p, n)),
    onTokens: mySeat && mine && !mine.setup?.battlefield && !mine.setup?.champion ? () => setModal({ type: 'tokens' }) : null,
    previewCard: (cardId) => { setHover(null); setPreview({ seat: null, zone: 'stack', id: 'x', cardId }) },
  }
  const mineShow = Object.fromEntries(VIEW_ZONES.map(([k]) => [k, prefs.mine?.[k] ?? !DEFAULT_HIDDEN.includes(k)]))
  const oppShow = Object.fromEntries(VIEW_ZONES.map(([k]) => [k, prefs.opp?.[k] ?? false]))

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
    const isBf = kindOf(card) === 'battlefield'
    const actions = info ? actionsFor(preview.id).filter((a) => a.key !== 'view' && a.key !== 'marks') : []
    return (
      <div className="modal-bg preview-bg" onClick={() => setPreview(null)}>
        <div className="pv" onClick={(e) => e.stopPropagation()}>
          {card && (
            <div className={'pvimg' + (isBf ? ' bf' : '')} onClick={() => setPreview(null)}>
              <CardImg className="big" src={card.image_url} alt={card.name} battlefield={isBf} />
            </div>
          )}
          {info && (
            <div className="pv-bar">
              {actions.map((a) => (
                <button key={a.key + a.label} className={a.key === 'reveal' ? 'primary' : ''}
                  onClick={() => { a.run(); if (['aim', 'give', 'fx'].includes(a.key)) setPreview(null) }}>{a.label}</button>
              ))}
              {canMark(card, zone) && <CounterPanel inst={info.inst} {...markFns(preview.id)} />}
            </div>
          )}
        </div>
      </div>
    )
  }

  const hoverInfo = hover && mine ? findInst(mine, hover.id) : null
  const hoverCard = hoverInfo ? cards[hoverInfo.inst.cardId] : null
  const overlays = (
    <>
      {modal?.type === 'zone' && zoneModal()}
      {modal?.type === 'look' && mine && <LookModal zone={modal.zone} mine={mine} cards={cards} act={act} onClose={() => setModal(null)} />}
      {modal?.type === 'view' && <ViewModal prefs={prefs} setPrefs={setPrefs} rot={rot} setRot={setRot} onClose={() => setModal(null)} />}
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
      {modal?.type === 'tokens' && (
        <TokenModal tokens={Object.values(cards).filter((c) => kindOf(c) === 'token').sort((a, b) => (a.code || a.name).localeCompare(b.code || b.name))}
          onSpawn={(c, n) => { act((p) => spawnTokens(p, c, n, auto)); say(String(c.token_type).toLowerCase() === 'battlefield' && c.bf_mode === 'overlay' ? `${c.name} liegt im Base: auf das Battlefield ziehen, über das es gelegt werden soll.` : `${n}× ${c.name} gespielt.`) }} onClose={() => setModal(null)} />
      )}
      {payAsk && (
        <PayModal ask={payAsk} cards={cards} mine={mine}
          onCancel={() => setPayAsk(null)}
          onFree={() => { const a = payAsk; setPayAsk(null); act(a.run) }}
          onPay={(ids) => { const a = payAsk; setPayAsk(null); finishPay(planPayment(mineRef.current, a.cost, cards, ids), a.run, a.name, a.saved) }} />
      )}
      {notice && <div className="toast" role="status" onClick={() => setNotice('')}>{notice}</div>}
      {preview && previewNode()}
      {hover && hoverInfo && hoverInfo.zone === hover.zone && !drag && !preview && !aim && (
        <Floating rect={hover.rect} onEnter={keepHover} onLeave={hideHover}>
          {canMark(hoverCard, hoverInfo.zone) && <CounterPanel inst={hoverInfo.inst} {...markFns(hover.id)} />}
          <div className="hover-actions">
            {actionsFor(hover.id).filter((a) => ['aim', 'unaim', 'give', 'fx', 'detach', 'peekup', 'peekdown'].includes(a.key)).map((a) => (
              <button key={a.key + a.label} onClick={() => { setHover(null); a.run() }}>{a.label}</button>
            ))}
          </div>
        </Floating>
      )}
      <ArrowLayer players={players} mySeat={mySeat} onRemove={(from, to) => act((p) => removeTarget(p, from, to))} />
      {aim && tab === 'play' && aimOpen && <AimPanel players={players} cards={cards} bfSeats={bfSeats} aimId={aim.id} mySeat={mySeat} onPick={pickTarget} onClose={() => setAimOpen(false)} />}
      {aim && tab === 'play' && !aimOpen && <button className="aimshow" onClick={() => setAimOpen(true)}>Ziel-Übersicht zeigen</button>}
      {aim && (
        <div className="aimbar">
          <span>{aim.mode === 'arrow' ? 'Ziel wählen: tippe oder klicke die Karte, auf die der Pfeil zeigen soll.' : 'Ziel wählen: tippe oder klicke die Karte im Spiel, auf die die Karte zielt. Sie wird aufgedeckt und kommt auf den Stack.'}</span>
          {aim.mode !== 'arrow' && <button className="primary" onClick={noTarget}>Ohne Ziel</button>}
          <button onClick={() => setAim(null)}>Abbrechen</button>
        </div>
      )}
      {showing && (
        <div className="modal-bg preview-bg" onClick={() => setShowing(null)}>
          <div className="pv">
            <h3>{showing.name} zeigt:</h3>
            <div className="row" style={{ justifyContent: 'center' }}>
              {showing.cardIds.map((cid, i) => cards[cid] && <CardImg key={i} className="big" src={cards[cid].image_url} alt={cards[cid].name} battlefield={kindOf(cards[cid]) === 'battlefield'} />)}
            </div>
          </div>
        </div>
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
            <button onClick={() => setModal({ type: 'view' })}>Ansicht</button>
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

  const fanCw = vw < 700 ? 130 : Math.round(Math.min(210, Math.max(150, window.innerHeight * 0.26)))
  const playing = mine && !mine.setup?.battlefield && !mine.setup?.champion
  const openMore = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    setMenu({
      x: r.right - 190, y: r.bottom + 4,
      items: [
        { label: 'Ansicht anpassen…', run: () => setModal({ type: 'view' }) },
        { label: `Runen automatisch bezahlen: ${auto.pay ? 'an' : 'aus'}`, run: () => setAuto({ pay: !auto.pay }) },
        { label: `Legend-Rabatt anwenden: ${auto.legend !== false ? 'an' : 'aus'}`, run: () => setAuto({ legend: auto.legend === false }) },
        { label: `Einheiten automatisch tappen: ${auto.exhaust ? 'an' : 'aus'}`, run: () => setAuto({ exhaust: !auto.exhaust }) },
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
          {playing && (
            <>
              <button onClick={() => act(untapAll)}>Alles enttappen</button>
              {mine.outbox?.length > 0 && (
                <button title="Der Mitspieler hat die Karte noch nicht übernommen" onClick={() => act(takeBackGifts)}>Übergabe zurücknehmen ({mine.outbox.length})</button>
              )}
              <button onClick={openMore}>Mehr ▾</button>
            </>
          )}
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
            {tab === 'table' ? (
              <Table players={players} mySeat={mySeat} />
            ) : (
              <div className="play-main" style={{ paddingBottom: fanCw * 1.12 + 70 }}>
                <div className="mine-board"><MyBoard players={players} mySeat={mySeat} mineShow={mineShow} oppShow={oppShow} /></div>
              </div>
            )}
            {tab === 'play' && (
              <HandFan hand={mine.zones.hand} cards={cards} cw={fanCw} drag={drag}
                bind={(inst) => bindCard(mySeat, 'hand', inst)}
                onHide={(inst) => act((p) => toggleFlag(p, inst.id, 'faceDown'))}
                onPlay={(inst) => setAim({ id: inst.id, mode: 'play' })} />
            )}
          </>
         )}
        {overlays}
      </div>
    </GameCtx.Provider>
  )
}
