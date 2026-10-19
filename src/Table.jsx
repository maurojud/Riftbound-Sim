import { createContext, useContext } from 'react'
import { kindOf, COUNTERS, STATUSES } from './game'

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

export function CardView({ card, inst, reveal = true, small, xs, onClick, handlers, dim, owner, extra }) {
  const hidden = !card || (inst?.faceDown && !reveal)
  const land = kindOf(card) === 'battlefield' && !hidden
  const h = { ...(handlers || {}) }
  if (onClick) h.onClick = onClick
  const cls = ['card', inst?.tapped && 'tapped', small && 'small', xs && 'xs', land && 'land', dim && 'dim', owner && 'owned',
    (h.onClick || h.onPointerDown) && 'clickable', h.onPointerDown && 'draggable'].filter(Boolean).join(' ')
  return (
    <div className={cls} style={owner ? { '--oc': seatColor(owner) } : undefined} {...h} title={card?.name}>
      {hidden ? <div className="back" /> : <img src={card.image_url} alt={card.name} loading="lazy" draggable={false} />}
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

// split: zwei Ablageziele (oben/unten), die nur während des Ziehens erscheinen
function Pile({ label, count, topCard, hideTop, onClick, off, hint, drop, split }) {
  const g = useG()
  const showSplit = split && g.drag && split.some((s) => g.drag.allowed.includes(s.key))
  return (
    <button className={'pile' + (off ? ' off' : '') + dropCls(g, drop)} data-drop={drop} aria-disabled={off || undefined}
      onClick={() => { if (!off && onClick) onClick() }}>
      <div className={'pile-face' + (count ? '' : ' empty')}>
        {count > 0 && (topCard && !hideTop ? <img src={topCard.image_url} alt="" draggable={false} /> : <div className="back" />)}
        {showSplit && (
          <div className="sd">
            {split.map((s) => (
              <div key={s.key} data-drop={s.key} className={'sdh' + (g.drag.over === s.key ? ' dropover' : '')}>{s.label}</div>
            ))}
          </div>
        )}
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
  return (
    <div className="tag">
      <span className="dot" style={{ background: seatColor(player.seat) }} />
      <b>{player.name}</b>
      {player.state?.deckName && <span className="muted">{player.state.deckName}</span>}
      <span className="pts">{player.state?.points ?? 0} Punkte</span>
    </div>
  )
}

// Ein Battlefield-Feld: die Battlefield-Karte des Besitzers plus alle Einheiten, die irgendein Spieler dort hingespielt hat.
export function BfZone({ owner }) {
  const g = useG()
  const bf = owner.state?.zones.battlefield[0]
  const units = g.players.flatMap((p) =>
    (p.state?.zones.bfUnits || []).filter((i) => i.at === owner.seat).map((inst) => ({ inst, seat: p.seat })))
  const droppable = g.mySeat != null && !!bf
  return (
    <ZoneBox title={`Battlefield · ${owner.name}`} className="grow bf" drop={droppable ? `bf:${owner.seat}` : undefined}>
      <div className="bfbody">
        <div className="bfcard">
          {bf
            ? <CardView card={g.cards[bf.cardId]} inst={bf} handlers={g.bindCard(owner.seat, 'battlefield', bf)} />
            : <Empty>{owner.state ? 'wählt noch…' : 'noch kein Deck'}</Empty>}
        </div>
        <div className="bfunits">
          {units.map(({ inst, seat }) => (
            <CardView key={inst.id} card={g.cards[inst.cardId]} inst={inst} reveal={seat === g.mySeat} owner={seat}
              handlers={g.bindCard(seat, 'bfUnits', inst)} dim={g.drag?.id === inst.id} />
          ))}
        </div>
      </div>
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
  const hint = isMe ? 'ziehen' : null
  return (
    <div className="arow outer">
      <ZoneBox title="Runen" count={`${ready}/${z.runes.length} bereit`} className="grow runes">
        {z.runes.length ? <Cards seat={seat} zone="runes" list={z.runes} xs /> : <Empty>keine gezogen</Empty>}
      </ZoneBox>
      <ZoneBox title="Legend"><Cards seat={seat} zone="legend" list={z.legend} xs /></ZoneBox>
      <ZoneBox title="Champion" drop={isMe ? 'champion' : undefined}>
        {z.champion.length ? <Cards seat={seat} zone="champion" list={z.champion} xs /> : <Empty>leer</Empty>}
      </ZoneBox>
      <div className="piles">
        <Pile label="Deck" count={z.deck.length} hideTop off={!isMe} hint={hint} drop={isMe ? 'deckTop' : undefined}
          split={isMe ? [{ key: 'deckTop', label: 'oben' }, { key: 'deckBottom', label: 'unten' }] : null}
          onClick={() => g.onZone(seat, 'deck')} />
        <Pile label="Runen-D." count={z.runeDeck.length} hideTop off={!isMe} hint={hint} drop={isMe ? 'runeDeckTop' : undefined}
          split={isMe ? [{ key: 'runeDeckTop', label: 'oben' }, { key: 'runeDeckBottom', label: 'unten' }] : null}
          onClick={() => g.onZone(seat, 'runeDeck')} />
        <Pile label="Hand" count={isMe || g.settings.handCount ? z.hand.length : null} hideTop off drop={isMe ? 'hand' : undefined} />
        <Pile label="Trash" count={z.trash.length} topCard={top(z.trash)} hideTop={!isMe && !g.settings.trashTop}
          drop={isMe ? 'trash' : undefined} onClick={() => g.onZone(seat, 'trash')} />
        <Pile label="Banish" count={z.banish.length} topCard={top(z.banish)} drop={isMe ? 'banish' : undefined}
          onClick={() => g.onZone(seat, 'banish')} />
      </div>
    </div>
  )
}

// Eigene Ansicht auf Tablet/Handy: oben beide Battlefields nebeneinander, darunter Base, Runen, Legend und Stapel
export function MyBoard({ players, mySeat }) {
  const me = players.find((p) => p.seat === mySeat)
  if (!me?.state) return null
  return (
    <div className="myboard">
      <div className="bfrow">{players.map((pl) => <BfZone key={pl.seat} owner={pl} />)}</div>
      <Tag player={me} />
      <BaseRow player={me} />
      <OuterRow player={me} />
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
      <div className="mid">{players.map((pl) => <BfZone key={pl.seat} owner={pl} />)}</div>
      <div className="half">{bottom.map((pl) => <Half key={pl.seat} player={pl} variant="bottom" />)}</div>
    </div>
  )
}
