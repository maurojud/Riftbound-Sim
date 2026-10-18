import { createContext, useContext } from 'react'
import { kindOf } from './game'

// Alles, was die Tisch-Bausteine von der Session brauchen (Karten, Regeln, Zug, Drag-Zustand, Klick-Handler)
export const GameCtx = createContext(null)
const useG = () => useContext(GameCtx)

const dropCls = (g, key) => {
  if (!key || !g.drag || !g.drag.allowed.includes(key)) return ''
  return g.drag.over === key ? ' dropok dropover' : ' dropok'
}

export function CardView({ card, inst, reveal = true, small, xs, onClick, handlers, dim }) {
  const hidden = !card || (inst?.faceDown && !reveal)
  const land = kindOf(card) === 'battlefield' && !hidden
  const h = { ...(handlers || {}) }
  if (onClick) h.onClick = onClick
  const cls = ['card', inst?.tapped && 'tapped', small && 'small', xs && 'xs', land && 'land', dim && 'dim',
    (h.onClick || h.onPointerDown) && 'clickable', h.onPointerDown && 'draggable'].filter(Boolean).join(' ')
  return (
    <div className={cls} {...h} title={card?.name}>
      {hidden ? <div className="back" /> : <img src={card.image_url} alt={card.name} loading="lazy" draggable={false} />}
      {inst?.faceDown && reveal && <span className="badge">verdeckt</span>}
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

function Pile({ label, count, topCard, hideTop, onClick, disabled, hint, drop }) {
  const g = useG()
  return (
    <button className={'pile' + dropCls(g, drop)} data-drop={drop} onClick={onClick} disabled={disabled}>
      <div className={'pile-face' + (count ? '' : ' empty')}>
        {count > 0 && (topCard && !hideTop ? <img src={topCard.image_url} alt="" draggable={false} /> : <div className="back" />)}
      </div>
      <span>{label}{count != null ? ` ${count}` : ''}</span>
      {hint && <span className="hint">{hint}</span>}
    </button>
  )
}

function Cards({ seat, zone, list, xs }) {
  const g = useG()
  const own = seat === g.mySeat
  return list.map((inst) => (
    <CardView key={inst.id} card={g.cards[inst.cardId]} inst={inst} reveal={own} xs={xs}
      handlers={g.bindCard(seat, zone, inst)} dim={g.drag?.id === inst.id} />
  ))
}

const Empty = ({ children }) => <span className="muted small">{children}</span>

export function Tag({ player }) {
  const g = useG()
  const t = g.turn
  const active = t?.seat === player.seat
  const focus = t?.focus === player.seat
  return (
    <div className="tag">
      <b>{player.name}</b>
      {player.state?.deckName && <span className="muted">{player.state.deckName}</span>}
      {active && <span className="chip gold">am Zug</span>}
      {focus && <span className="chip blue">Fokus</span>}
      <span className="pts">{player.state?.points ?? 0} Punkte</span>
    </div>
  )
}

export function BfZone({ player }) {
  const g = useG()
  const { seat, name, state } = player
  const isMe = seat === g.mySeat
  return (
    <ZoneBox title={`Battlefield · ${name}`} className={'grow bf' + (g.turn?.seat === seat ? ' active' : '')} drop={isMe ? 'battlefield' : undefined}>
      {state?.zones.battlefield.length ? <Cards seat={seat} zone="battlefield" list={state.zones.battlefield} /> : <Empty>noch keins</Empty>}
    </ZoneBox>
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

export function OuterRow({ player }) {
  const g = useG()
  const { seat, state } = player
  if (!state) return null
  const z = state.zones
  const isMe = seat === g.mySeat
  const ready = z.runes.filter((r) => !r.tapped).length
  const top = (arr) => (arr.length ? g.cards[arr[arr.length - 1].cardId] : null)
  const hint = isMe && g.canAct ? 'ziehen' : null
  return (
    <div className="arow outer">
      <ZoneBox title="Runen" count={`${ready}/${z.runes.length} bereit`} className="grow runes" drop={isMe ? 'runes' : undefined}>
        {z.runes.length ? <Cards seat={seat} zone="runes" list={z.runes} xs /> : <Empty>keine gezogen</Empty>}
      </ZoneBox>
      <ZoneBox title="Legend"><Cards seat={seat} zone="legend" list={z.legend} xs /></ZoneBox>
      <ZoneBox title="Champion" drop={isMe ? 'champion' : undefined}>
        {z.champion.length ? <Cards seat={seat} zone="champion" list={z.champion} xs /> : <Empty>leer</Empty>}
      </ZoneBox>
      <div className="piles">
        <Pile label="Deck" count={z.deck.length} hideTop disabled={!isMe || !g.canAct} hint={hint} drop={isMe ? 'deckTop' : undefined} onClick={() => g.onZone(seat, 'deck')} />
        <Pile label="Runen-D." count={z.runeDeck.length} hideTop disabled={!isMe || !g.canAct} hint={hint} drop={isMe ? 'runeDeckTop' : undefined} onClick={() => g.onZone(seat, 'runeDeck')} />
        <Pile label="Hand" count={isMe || g.settings.handCount ? z.hand.length : null} hideTop disabled />
        <Pile label="Trash" count={z.trash.length} topCard={top(z.trash)} hideTop={!isMe && !g.settings.trashTop} drop={isMe ? 'trash' : undefined} onClick={() => g.onZone(seat, 'trash')} />
        <Pile label="Banish" count={z.banish.length} topCard={top(z.banish)} drop={isMe ? 'banish' : undefined} onClick={() => g.onZone(seat, 'banish')} />
      </div>
    </div>
  )
}

// Eigene Ansicht auf dem Tablet/Handy: Battlefield, Base, Runen/Legend/Piles
export function MyBoard({ player }) {
  if (!player.state) return null
  return (
    <div className="myboard">
      <Tag player={player} />
      <BfZone player={player} />
      <BaseRow player={player} />
      <OuterRow player={player} />
    </div>
  )
}

function Half({ player, variant }) {
  const g = useG()
  const active = g.turn?.seat === player.seat
  const cls = `hp ${variant}${active ? ' active' : ''}${player.seat === g.mySeat ? ' me' : ''}`
  if (!player.state) {
    return <div className={cls}><Tag player={player} /><p className="muted pad">Wählt noch ein Deck…</p></div>
  }
  // gespiegelt: Runen/Legend außen, Base Richtung Mitte
  return (
    <div className={cls}>
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
  return (
    <div className={`tvtable n${n}`}>
      <div className="half">{top.map((pl) => <Half key={pl.seat} player={pl} variant="top" />)}</div>
      <div className="mid">{ordered.map((pl) => <BfZone key={pl.seat} player={pl} />)}</div>
      <div className="half">{bottom.map((pl) => <Half key={pl.seat} player={pl} variant="bottom" />)}</div>
    </div>
  )
}
