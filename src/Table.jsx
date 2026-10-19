import { createContext, useContext } from 'react'
import { kindOf, COUNTERS, STATUSES, stackFor, stackSig, approvedBy } from './game'
import CardImg from './CardImg'

// Alles, was die Tisch-Bausteine von der Session brauchen (Karten, Regeln, Spieler, Drag-Zustand, Klick-Handler)
export const GameCtx = createContext(null)
const useG = () => useContext(GameCtx)

export const SEAT_COLORS = ['#6cb8ff', '#ff9a6c', '#8fd7a4', '#d79cff']
export const seatColor = (seat) => SEAT_COLORS[(((seat || 1) - 1) % 4 + 4) % 4]

const dropCls = (g, key) => {
  if (!key || !g.drag || !g.drag.allowed.includes(key)) return ''
  return g.drag.over === key ? ' dropok dropover' : ' dropok'
}

// Marken (Buff, Schaden, Might, Marker, Stunned) als kleine Chips unten auf der Karte
function Marks({ inst }) {
  const c = inst.counters || {}
  const st = inst.status || {}
  const chips = []
  COUNTERS.forEach((d) => {
    if (c[d.key]) chips.push([d.key, `${d.label} ${d.signed && c[d.key] > 0 ? '+' : ''}${c[d.key]}`])
  })
  STATUSES.forEach((d) => { if (st[d.key]) chips.push([d.key, d.label]) })
  if (!chips.length) return null
  return <div className="marks">{chips.map(([k, t]) => <span key={k} className={'mk ' + k}>{t}</span>)}</div>
}

export function CardView({ card, inst, reveal = true, small, xs, onClick, handlers, dim, owner, extra, aimFrom }) {
  const hidden = !card || (inst?.faceDown && !reveal)
  const land = kindOf(card) === 'battlefield' && !hidden
  const h = { ...(handlers || {}) }
  if (onClick) h.onClick = onClick
  const cls = ['card', inst?.tapped && 'tapped', small && 'small', xs && 'xs', land && 'land', dim && 'dim', owner && 'owned', aimFrom && 'aimfrom',
    (h.onClick || h.onPointerDown) && 'clickable', h.onPointerDown && 'draggable'].filter(Boolean).join(' ')
  return (
    <div className={cls} style={owner ? { '--oc': seatColor(owner) } : undefined} data-iid={inst?.id} {...h} title={card?.name}>
      {hidden ? <div className="back" /> : <CardImg src={card.image_url} alt={card.name} battlefield={land} />}
      {inst?.faceDown && reveal && <span className="badge">verdeckt</span>}
      {!hidden && inst && <Marks inst={inst} />}
      {extra}
    </div>
  )
}

// Zähler- und Statusübersicht (beim Hovern über eine Karte im Spiel oder in der Vorschau)
export function CounterPanel({ inst, onCounter, onStatus, onClear }) {
  const c = inst.counters || {}
  const st = inst.status || {}
  return (
    <div className="cp">
      {COUNTERS.map((d) => (
        <div className="cp-row" key={d.key}>
          <span>{d.label}</span>
          <span className="cp-ctl">
            <button aria-label={d.label + ' weniger'} onClick={() => onCounter(d.key, -1)}>−</button>
            <b>{d.signed && (c[d.key] || 0) > 0 ? '+' : ''}{c[d.key] || 0}</b>
            <button aria-label={d.label + ' mehr'} onClick={() => onCounter(d.key, 1)}>+</button>
          </span>
        </div>
      ))}
      <div className="cp-chips">
        {STATUSES.map((d) => (
          <button key={d.key} className={st[d.key] ? 'on' : ''} onClick={() => onStatus(d.key)}>{d.label}</button>
        ))}
        <button onClick={onClear}>Zurücksetzen</button>
      </div>
    </div>
  )
}

function ZoneBox({ title, count, children, className = '', drop }) {
  const g = useG()
  return (
    <div className={`zonebox ${className}${dropCls(g, drop)}`} data-drop={drop}>
      <div className="zt">{title}{count != null && <span className="muted"> · {count}</span>}</div>
      <div className="zc">{children}</div>
    </div>
  )
}

// Stapel mit fester Größe. handlers: Klick (ziehen/öffnen) und Menü (Rechtsklick oder langes Drücken) kommen aus der Session.
function Pile({ label, count, topCard, hideTop, off, drop, handlers, tip }) {
  const g = useG()
  return (
    <button className={'pile' + (off ? ' off' : '') + dropCls(g, drop)} data-drop={drop} aria-disabled={off || undefined} title={tip} {...(off ? {} : handlers)}>
      <div className={'pile-face' + (count ? '' : ' empty')}>
        {count > 0 && (topCard && !hideTop ? <img src={topCard.image_url} alt="" draggable={false} /> : <div className="back" />)}
      </div>
      <span>{label}{count != null ? ` ${count}` : ''}</span>
    </button>
  )
}

function Cards({ seat, zone, list, xs }) {
  const g = useG()
  const own = seat === g.mySeat
  return list.map((inst) => (
    <CardView key={inst.id} card={g.cards[inst.cardId]} inst={inst} reveal={own} xs={xs}
      handlers={g.bindCard(seat, zone, inst)} dim={g.drag?.id === inst.id} aimFrom={g.aim === inst.id} />
  ))
}

const Empty = ({ children }) => <span className="muted small">{children}</span>

export function Tag({ player }) {
  return (
    <div className="tag">
      <span className="dot" style={{ background: seatColor(player.seat) }} />
      <b>{player.name}</b>
      {player.state?.deckName && <span className="muted">{player.state.deckName}</span>}
      <span className="pts">{player.state?.points ?? 0} Punkte</span>
    </div>
  )
}

// Stack eines Battlefields: oben liegt, was zuerst aufgelöst wird. Alle Spieler bestätigen mit OK, dann löst der Besitzer der obersten Karte auf.
function StackBox({ owner, stack, sig }) {
  const g = useG()
  const everyone = g.players.filter((p) => p.state)
  const approved = everyone.map((p) => ({ p, ok: approvedBy(p, owner.seat, sig) }))
  const allOk = stack.length > 0 && approved.every((a) => a.ok)
  const top = stack[stack.length - 1]
  const iOk = approved.some((a) => a.p.seat === g.mySeat && a.ok)
  return (
    <div className={'stackbox' + dropCls(g, g.mySeat != null ? `stack:${owner.seat}` : null)} data-drop={g.mySeat != null ? `stack:${owner.seat}` : undefined}>
      <div className="stack-head">
        <div className="zt">Stack{stack.length ? ` · ${stack.length}` : ''}</div>
      <div className="stack-ctl">
        {stack.length > 0 && (<>
          <span className="oks">
            {approved.map(({ p, ok }) => (
              <span key={p.seat} className={'okdot' + (ok ? ' on' : '')} style={{ '--oc': seatColor(p.seat) }} title={`${p.name}: ${ok ? 'OK' : 'wartet'}`} />
            ))}
          </span>
          {g.mySeat != null && (
            <button className={iOk ? 'primary' : ''} onClick={() => g.onApprove(owner.seat, sig, !iOk)}>{iOk ? 'OK ✓' : 'OK'}</button>
          )}
          {allOk && top.seat === g.mySeat && <button className="primary" onClick={() => g.onResolve(top.inst.id, owner.seat)}>Auflösen</button>}
          {allOk && top.seat !== g.mySeat && <span className="muted small">{g.players.find((p) => p.seat === top.seat)?.name} löst auf</span>}
        </>)}
      </div>
      </div>
      <div className="stack-list">
        {stack.length === 0 && <span className="muted small stack-empty">Karte hierher ziehen</span>}
        {[...stack].reverse().map((e, i) => (
          <CardView key={e.inst.id} xs card={g.cards[e.inst.cardId]} inst={e.inst} owner={e.seat}
            handlers={g.bindCard(e.seat, 'stack', e.inst)} dim={g.drag?.id === e.inst.id} aimFrom={g.aim === e.inst.id}
            extra={i === 0 && stack.length > 1 ? <span className="topbadge">oben</span> : null} />
        ))}
      </div>
    </div>
  )
}

// Ein Battlefield-Feld: oben und unten je eine Einheiten-Zone (die Karten eines Spielers liegen in der Zone auf seiner Seite),
// in der Mitte die Battlefield-Karte (immer quer) und der Stack.
export function BfZone({ owner, topSeats }) {
  const g = useG()
  const bf = owner.state?.zones.battlefield[0]
  const stack = stackFor(g.players, owner.seat)
  const sig = stackSig(stack)
  const droppable = g.mySeat != null && !!bf
  const strip = (top) => {
    const seats = g.players.filter((p) => topSeats.has(p.seat) === top)
    const units = seats.flatMap((p) => (p.state?.zones.bfUnits || []).filter((i) => i.at === owner.seat).map((inst) => ({ inst, seat: p.seat })))
    return (
      <div className={'bfstrip ' + (top ? 'top' : 'bottom')}>
        {units.map(({ inst, seat }) => (
          <CardView key={inst.id} xs card={g.cards[inst.cardId]} inst={inst} reveal={seat === g.mySeat} owner={seat}
            handlers={g.bindCard(seat, 'bfUnits', inst)} dim={g.drag?.id === inst.id} aimFrom={g.aim === inst.id} />
        ))}
        {!units.length && <span className="strip-l">{seats.map((p) => p.name).join(' · ')}</span>}
      </div>
    )
  }
  return (
    <div className={'zonebox bf' + dropCls(g, droppable ? `bf:${owner.seat}` : null)} data-drop={droppable ? `bf:${owner.seat}` : undefined}>
      <div className="zt"><span className="dot" style={{ background: seatColor(owner.seat) }} /> Battlefield · {owner.name}</div>
      {strip(true)}
      <div className="bfmid">
        <div className="bfcard">
          {bf
            ? <CardView card={g.cards[bf.cardId]} inst={bf} handlers={g.bindCard(owner.seat, 'battlefield', bf)} aimFrom={g.aim === bf.id} />
            : <Empty>{owner.state ? 'wählt noch…' : 'noch kein Deck'}</Empty>}
        </div>
        <StackBox owner={owner} stack={stack} sig={sig} />
      </div>
      {strip(false)}
    </div>
  )
}

export function BaseRow({ player }) {
  const g = useG()
  const { seat, state } = player
  return (
    <div className="arow baserow">
      <ZoneBox title="Base" className="grow" drop={seat === g.mySeat ? 'base' : undefined}>
        {state?.zones.base.length ? <Cards seat={seat} zone="base" list={state.zones.base} /> : <Empty>leer</Empty>}
      </ZoneBox>
    </div>
  )
}

// show: welche Zonen angezeigt werden (Standard: alle)
export function OuterRow({ player, show }) {
  const g = useG()
  const { seat, state } = player
  if (!state) return null
  const z = state.zones
  const isMe = seat === g.mySeat
  const on = (k) => !show || show[k] !== false
  const ready = z.runes.filter((r) => !r.tapped).length
  const top = (arr) => (arr.length ? g.cards[arr[arr.length - 1].cardId] : null)
  const piles = ['deck', 'runeDeck', 'hand', 'trash', 'banish'].filter(on)
  return (
    <div className="arow outer">
      {on('runes') && (
        <ZoneBox title="Runen" count={`${ready}/${z.runes.length} bereit`} className="grow runes">
          {z.runes.length ? <Cards seat={seat} zone="runes" list={z.runes} xs /> : <Empty>keine gezogen</Empty>}
        </ZoneBox>
      )}
      {on('legend') && <ZoneBox title="Legend" className="fixed"><Cards seat={seat} zone="legend" list={z.legend} xs /></ZoneBox>}
      {on('champion') && (
        <ZoneBox title="Champion" className="fixed" drop={isMe ? 'champion' : undefined}>
          {z.champion.length ? <Cards seat={seat} zone="champion" list={z.champion} xs /> : <Empty>leer</Empty>}
        </ZoneBox>
      )}
      {piles.length > 0 && (
        <div className="piles">
          {on('deck') && <Pile label="Deck" count={z.deck.length} hideTop off={!isMe} tip="Klick: Karte ziehen · Rechtsklick oder lange drücken: Menü" drop={isMe ? 'deck' : undefined} handlers={g.bindPile(seat, 'deck')} />}
          {on('runeDeck') && <Pile label="Runen-D." count={z.runeDeck.length} hideTop off={!isMe} tip="Klick: Rune ziehen · Rechtsklick oder lange drücken: Menü" drop={isMe ? 'runeDeck' : undefined} handlers={g.bindPile(seat, 'runeDeck')} />}
          {on('hand') && <Pile label="Hand" count={isMe || g.settings.handCount ? z.hand.length : null} hideTop off drop={isMe ? 'hand' : undefined} />}
          {on('trash') && <Pile label="Trash" count={z.trash.length} topCard={top(z.trash)} hideTop={!isMe && !g.settings.trashTop}
            drop={isMe ? 'trash' : undefined} handlers={g.bindPile(seat, 'trash')} />}
          {on('banish') && <Pile label="Banish" count={z.banish.length} topCard={top(z.banish)} drop={isMe ? 'banish' : undefined}
            handlers={g.bindPile(seat, 'banish')} />}
        </div>
      )}
    </div>
  )
}

// Eigene Ansicht auf Tablet/Handy: Gegner-Felder nach Wunsch, beide Battlefields, dann Base, Runen, Legend und Stapel.
// mineShow / oppShow: welche Zonen sichtbar sind (siehe Mehr > Ansicht).
export function MyBoard({ players, mySeat, mineShow, oppShow }) {
  const me = players.find((p) => p.seat === mySeat)
  if (!me?.state) return null
  const topSeats = new Set(players.filter((p) => p.seat !== mySeat).map((p) => p.seat))
  const opps = players.filter((p) => p.seat !== mySeat && p.state)
  const oppAny = oppShow && Object.values(oppShow).some(Boolean)
  const mineAny = (k) => !mineShow || mineShow[k] !== false
  return (
    <div className="myboard">
      {oppAny && opps.map((o) => (
        <div key={o.seat} className="opp">
          <Tag player={o} />
          {oppShow.base && <BaseRow player={o} />}
          <OuterRow player={o} show={oppShow} />
        </div>
      ))}
      <div className="bfrow">{players.map((pl) => <BfZone key={pl.seat} owner={pl} topSeats={topSeats} />)}</div>
      <Tag player={me} />
      {mineAny('base') && <BaseRow player={me} />}
      <OuterRow player={me} show={mineShow} />
    </div>
  )
}

function Half({ player, variant }) {
  const g = useG()
  const cls = `hp ${variant}${player.seat === g.mySeat ? ' me' : ''}`
  if (!player.state) {
    return <div className={cls}><Tag player={player} /><p className="muted pad">Wählt noch ein Deck…</p></div>
  }
  // gespiegelt: Runen/Legend außen, Base Richtung Mitte
  return (
    <div className={cls} style={{ '--sc': seatColor(player.seat) }}>
      {variant === 'top'
        ? <><Tag player={player} /><OuterRow player={player} /><BaseRow player={player} /></>
        : <><BaseRow player={player} /><OuterRow player={player} /><Tag player={player} /></>}
    </div>
  )
}

export function Table({ players, mySeat }) {
  if (!players.length) return <div className="empty">Noch keine Spieler. Tritt mit dem Code bei.</div>
  // eigener Platz immer unten
  const ordered = mySeat ? [...players.filter((p) => p.seat !== mySeat), ...players.filter((p) => p.seat === mySeat)] : players
  const n = ordered.length
  const topN = n === 1 ? 0 : Math.ceil(n / 2)
  const top = ordered.slice(0, topN)
  const bottom = ordered.slice(topN)
  const topSeats = new Set(top.map((p) => p.seat))
  return (
    <div className={`tvtable n${n}`}>
      <div className="half">{top.map((pl) => <Half key={pl.seat} player={pl} variant="top" />)}</div>
      <div className="mid">{players.map((pl) => <BfZone key={pl.seat} owner={pl} topSeats={topSeats} />)}</div>
      <div className="half">{bottom.map((pl) => <Half key={pl.seat} player={pl} variant="bottom" />)}</div>
    </div>
  )
}
