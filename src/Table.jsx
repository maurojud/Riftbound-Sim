import { kindOf } from './game'

export function CardView({ card, inst, reveal = true, onClick, small, selected }) {
  const hidden = !card || (inst?.faceDown && !reveal)
  const land = kindOf(card) === 'battlefield' && !hidden
  return (
    <div
      className={`card${inst?.tapped ? ' tapped' : ''}${small ? ' small' : ''}${onClick ? ' clickable' : ''}${selected ? ' sel' : ''}${land ? ' land' : ''}`}
      onClick={onClick}
      title={card?.name}
    >
      {hidden ? <div className="back" /> : <img src={card.image_url} alt={card.name} loading="lazy" draggable={false} />}
      {inst?.faceDown && reveal && <span className="badge">verdeckt</span>}
    </div>
  )
}

export function ZoneBox({ title, count, children, className = '' }) {
  return (
    <div className={`zonebox ${className}`}>
      <div className="zt">{title}{count != null && <span className="muted"> · {count}</span>}</div>
      <div className="zc">{children}</div>
    </div>
  )
}

export function Pile({ label, count, topCard, hideTop, onClick, disabled, hint }) {
  return (
    <button className="pile" onClick={onClick} disabled={disabled}>
      <div className={'pile-face' + (count ? '' : ' empty')}>
        {count > 0 && (topCard && !hideTop ? <img src={topCard.image_url} alt="" draggable={false} /> : <div className="back" />)}
      </div>
      <span>{label}{count != null ? ` · ${count}` : ''}</span>
      {hint && <span className="hint">{hint}</span>}
    </button>
  )
}

export function PlayerArea({ player, cards, settings, isMe, selId, onCard, onZone, ownControls }) {
  const { seat, name, state } = player
  if (!state) {
    return (
      <section className="area">
        <header><b>{name}</b><span className="muted">Platz {seat}</span></header>
        <p className="muted pad">Wählt noch ein Deck…</p>
      </section>
    )
  }
  const z = state.zones
  const cardOf = (inst) => cards[inst.cardId]
  const top = (arr) => (arr.length ? cardOf(arr[arr.length - 1]) : null)
  const cv = (zone, inst) => (
    <CardView
      key={inst.id} card={cardOf(inst)} inst={inst} reveal={isMe}
      selected={isMe && inst.id === selId} onClick={() => onCard(seat, zone, inst)}
    />
  )
  const ready = z.runes.filter((r) => !r.tapped).length
  return (
    <section className={'area' + (isMe ? ' me' : '')}>
      <header>
        <b>{name}</b>
        <span className="muted">Platz {seat}{state.deckName ? ` · ${state.deckName}` : ''}</span>
        <span className="pts">{state.points} Punkte</span>
      </header>

      <div className="arow">
        <ZoneBox title="Legend">{z.legend.map((i) => cv('legend', i))}</ZoneBox>
        <ZoneBox title="Champion">{z.champion.length ? z.champion.map((i) => cv('champion', i)) : <span className="muted small">leer</span>}</ZoneBox>
        <ZoneBox title="Battlefield" className="grow">
          {z.battlefield.length ? z.battlefield.map((i) => cv('battlefield', i)) : <span className="muted small">noch keins</span>}
        </ZoneBox>
      </div>

      <div className="arow">
        <ZoneBox title="Base" className="grow">
          {z.base.length ? z.base.map((i) => cv('base', i)) : <span className="muted small">leer</span>}
        </ZoneBox>
      </div>

      <div className="arow">
        <ZoneBox title="Runen" count={`${ready} von ${z.runes.length} bereit`} className="grow">
          {z.runes.length ? z.runes.map((i) => cv('runes', i)) : <span className="muted small">keine gezogen</span>}
        </ZoneBox>
        <div className="piles">
          <Pile label="Deck" count={z.deck.length} hideTop disabled={!isMe} hint={isMe ? 'tippen = ziehen' : null} onClick={() => onZone(seat, 'deck')} />
          <Pile label="Runendeck" count={z.runeDeck.length} hideTop disabled={!isMe} hint={isMe ? 'tippen = ziehen' : null} onClick={() => onZone(seat, 'runeDeck')} />
          <Pile label="Hand" count={isMe || settings.handCount ? z.hand.length : null} hideTop disabled />
          <Pile label="Trash" count={z.trash.length} topCard={top(z.trash)} hideTop={!isMe && !settings.trashTop} onClick={() => onZone(seat, 'trash')} />
          <Pile label="Banish" count={z.banish.length} topCard={top(z.banish)} onClick={() => onZone(seat, 'banish')} />
        </div>
      </div>
      {ownControls}
    </section>
  )
}

export function Table({ players, cards, settings, mySeat, selId, onCard, onZone }) {
  if (!players.length) return <div className="empty">Noch keine Spieler. Tritt mit dem Code bei.</div>
  return (
    <div className={`table n${players.length}`}>
      {players.map((pl) => (
        <PlayerArea key={pl.seat} player={pl} cards={cards} settings={settings} isMe={pl.seat === mySeat} selId={selId} onCard={onCard} onZone={onZone} />
      ))}
    </div>
  )
}
