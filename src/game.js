// Spiellogik ohne Regel-Engine: Zonen, Karteninstanzen und Aktionen. Was erlaubt ist, steuern nur die Zonen-Optionen unten.
export const ZONES = {
  hand: 'Hand',
  base: 'Base',
  battlefield: 'Battlefield',
  deck: 'Deck',
  runeDeck: 'Runendeck',
  legend: 'Legend',
  champion: 'Champion',
  runes: 'Runen',
  trash: 'Trash',
  banish: 'Banish',
}

export const TARGET_LABEL = {
  hand: 'Hand', base: 'Base', battlefield: 'Battlefield', champion: 'Champion', trash: 'Trash', banish: 'Banish',
  deckTop: 'Auf Deck', deckBottom: 'Unter Deck', runes: 'Runenzone', runeDeckTop: 'Auf Runendeck', runeDeckBottom: 'Unter Runendeck',
}

export const KINDS = ['Unit', 'Champion', 'Spell', 'Gear', 'Legend', 'Battlefield', 'Rune', 'Token', 'Other']
export const COLORS = ['Fury', 'Calm', 'Mind', 'Body', 'Chaos', 'Order']

export const DECK_RULES = { main: 40, copies: 3, legend: 1, battlefields: 3, runes: 12, runeColors: 2 }

export const DEFAULT_SETTINGS = {
  trashTop: true,           // oberste Trash-Karte der anderen sichtbar
  trashInspect: true,       // andere dürfen den ganzen Trash ansehen
  handCount: true,          // Anzahl der Handkarten der anderen sichtbar
  battlefieldRandom: false, // Battlefield zufällig zuweisen statt selbst wählen
}

export const kindOf = (c) => (c?.kind || '').toLowerCase()

const uid = () => Math.random().toString(36).slice(2, 10)

export function shuffled(arr) {
  const r = [...arr]
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[r[i], r[j]] = [r[j], r[i]]
  }
  return r
}

// ───────── Deck-Analyse (Deckbuilder und Deckauswahl) ─────────
export function analyzeDeck(qty, byId) {
  const r = { main: 0, legend: 0, battlefield: 0, rune: 0, colors: [], copies: {}, problems: [] }
  const colors = new Set()
  for (const [id, n] of Object.entries(qty)) {
    const c = byId[id]
    if (!c) continue
    const k = kindOf(c)
    if (k === 'legend') r.legend += n
    else if (k === 'battlefield') r.battlefield += n
    else if (k === 'rune') { r.rune += n; colors.add(c.color || 'ohne Farbe') }
    else { r.main += n; r.copies[c.name] = (r.copies[c.name] || 0) + n }
  }
  r.colors = [...colors]
  const R = DECK_RULES
  if (r.main !== R.main) r.problems.push(`Deck: ${r.main} von ${R.main} Karten`)
  if (r.legend !== R.legend) r.problems.push(`Legend: ${r.legend} von ${R.legend}`)
  if (r.battlefield !== R.battlefields) r.problems.push(`Battlefields: ${r.battlefield} von ${R.battlefields}`)
  if (r.rune !== R.runes) r.problems.push(`Runen: ${r.rune} von ${R.runes}`)
  if (r.colors.length > R.runeColors) r.problems.push(`Runenfarben: ${r.colors.length} (max. ${R.runeColors})`)
  for (const [name, n] of Object.entries(r.copies)) if (n > R.copies) r.problems.push(`${name}: ${n}× (max. ${R.copies})`)
  r.valid = r.problems.length === 0
  return r
}

// Gibt null zurück, wenn die Karte hinzugefügt werden darf, sonst den Grund.
export function canAdd(qty, byId, card) {
  const a = analyzeDeck(qty, byId)
  const k = kindOf(card)
  const R = DECK_RULES
  if (k === 'legend') return a.legend >= R.legend ? 'Nur 1 Legend erlaubt.' : null
  if (k === 'battlefield') {
    if (a.battlefield >= R.battlefields) return 'Maximal 3 Battlefields.'
    const same = Object.entries(qty).some(([id, n]) => n > 0 && byId[id]?.name === card.name)
    return same ? 'Jedes Battlefield nur einmal.' : null
  }
  if (k === 'rune') {
    if (a.rune >= R.runes) return 'Maximal 12 Runen.'
    const col = card.color || 'ohne Farbe'
    if (!a.colors.includes(col) && a.colors.length >= R.runeColors) return 'Maximal 2 Runenfarben.'
    return null
  }
  if (a.main >= R.main) return 'Das Deck hat schon 40 Karten.'
  if ((a.copies[card.name] || 0) >= R.copies) return 'Maximal 3 Kopien pro Karte.'
  return null
}

// ───────── Spielzustand ─────────
const emptyZones = () => ({
  hand: [], base: [], battlefield: [], deck: [], runeDeck: [], legend: [], champion: [], runes: [], trash: [], banish: [], bfPool: [],
})
const clone = (p) => JSON.parse(JSON.stringify(p))
export const isValidState = (s) => !!(s && s.zones && s.zones.base)

export function buildPlayer(deck, cardsById, settings = DEFAULT_SETTINGS) {
  const zones = emptyZones()
  for (const { card_id, qty } of deck.cards || []) {
    const c = cardsById[card_id]
    if (!c) continue
    const k = kindOf(c)
    for (let i = 0; i < qty; i++) {
      const inst = { id: uid(), cardId: card_id, tapped: false, faceDown: false }
      if (k === 'rune') zones.runeDeck.push(inst)
      else if (k === 'legend') zones.legend.push(inst)
      else if (k === 'battlefield') zones.bfPool.push(inst)
      else zones.deck.push(inst)
    }
  }
  zones.deck = shuffled(zones.deck)
  zones.runeDeck = shuffled(zones.runeDeck)
  if (settings.battlefieldRandom && zones.bfPool.length) {
    const pick = Math.floor(Math.random() * zones.bfPool.length)
    zones.battlefield.push(zones.bfPool.splice(pick, 1)[0])
  }
  return {
    v: 2, points: 0, deckName: deck.name, zones,
    setup: { battlefield: zones.bfPool.length > 0 && zones.battlefield.length === 0, champion: true },
  }
}

export function findInst(p, id) {
  if (!p) return null
  for (const zone of Object.keys(p.zones)) {
    const inst = p.zones[zone].find((c) => c.id === id)
    if (inst) return { zone, inst }
  }
  return null
}

function take(p, instId) {
  for (const z of Object.keys(p.zones)) {
    const i = p.zones[z].findIndex((c) => c.id === instId)
    if (i >= 0) return p.zones[z].splice(i, 1)[0]
  }
  return null
}

// to: Zonenname oder deckTop, deckBottom, runeDeckTop, runeDeckBottom. Index 0 = oben bei Decks, letzte Karte = oben im Trash/Banish.
export function moveCard(p, instId, to) {
  const n = clone(p)
  const inst = take(n, instId)
  if (!inst) return p
  inst.tapped = false
  inst.faceDown = false
  if (to === 'deckTop') n.zones.deck.unshift(inst)
  else if (to === 'deckBottom') n.zones.deck.push(inst)
  else if (to === 'runeDeckTop') n.zones.runeDeck.unshift(inst)
  else if (to === 'runeDeckBottom') n.zones.runeDeck.push(inst)
  else n.zones[to].push(inst)
  return n
}

// Wohin darf eine Karte? Runen und Legend sind streng, alles andere frei.
const FREE_TARGETS = ['base', 'battlefield', 'hand', 'champion', 'trash', 'banish', 'deckTop', 'deckBottom']
export function targetsFor(card, zone) {
  const k = kindOf(card)
  let list
  if (k === 'rune') list = ['runes', 'runeDeckTop', 'runeDeckBottom']
  else if (k === 'legend' || k === 'battlefield') list = []
  else list = FREE_TARGETS
  return list.filter((t) => t !== zone)
}
const TAP_ZONES = ['base', 'battlefield', 'champion', 'runes', 'legend']
export const canTap = (card, zone) => TAP_ZONES.includes(zone) && kindOf(card) !== 'battlefield'
export const canFlip = (card, zone) => ['base', 'battlefield', 'champion'].includes(zone) && !['legend', 'battlefield', 'rune'].includes(kindOf(card))

export function toggleFlag(p, instId, flag) {
  const n = clone(p)
  const f = findInst(n, instId)
  if (f) f.inst[flag] = !f.inst[flag]
  return n
}

export function draw(p, count = 1) {
  const n = clone(p)
  for (let i = 0; i < count && n.zones.deck.length; i++) n.zones.hand.push(n.zones.deck.shift())
  return n
}

export function drawRune(p, count = 1) {
  const n = clone(p)
  for (let i = 0; i < count && n.zones.runeDeck.length; i++) n.zones.runes.push(n.zones.runeDeck.shift())
  return n
}

export function shuffleZone(p, zone) {
  const n = clone(p)
  n.zones[zone] = shuffled(n.zones[zone])
  return n
}

export function untapAll(p) {
  const n = clone(p)
  for (const z of TAP_ZONES) n.zones[z].forEach((c) => (c.tapped = false))
  return n
}

export function addPoints(p, d) {
  const n = clone(p)
  n.points = Math.max(0, (n.points || 0) + d)
  return n
}

export function pickBattlefield(p, instId) {
  const n = clone(p)
  const i = n.zones.bfPool.findIndex((c) => c.id === instId)
  if (i >= 0) n.zones.battlefield.push(n.zones.bfPool.splice(i, 1)[0])
  n.setup = { ...(n.setup || {}), battlefield: false }
  return n
}

export function pickChampion(p, instId) {
  let n = clone(p)
  if (instId) n = moveCard(n, instId, 'champion')
  n.setup = { ...(n.setup || {}), champion: false }
  return n
}
