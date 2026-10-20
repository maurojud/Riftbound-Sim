// Spiellogik ohne Regel-Engine: Zonen, Karteninstanzen und Aktionen. Was erlaubt ist, steuern nur die Zonen-Optionen unten.
export const ZONES = {
  hand: 'Hand',
  base: 'Base',
  battlefield: 'Battlefield',
  bfUnits: 'Battlefield',
  bfExtra: 'Battlefield',
  stack: 'Stack',
  deck: 'Deck',
  runeDeck: 'Runendeck',
  legend: 'Legend',
  champion: 'Champion',
  runes: 'Runen',
  trash: 'Trash',
  banish: 'Banish',
}

export const TARGET_LABEL = {
  stack: 'Stack',
  hand: 'Hand', base: 'Base', battlefield: 'Battlefield', champion: 'Champion', trash: 'Trash', banish: 'Banish',
  deck: 'Deck', runeDeck: 'Runendeck', deckTop: 'Auf Deck', deckBottom: 'Unter Deck', runes: 'Runenzone', runeDeckTop: 'Auf Runendeck', runeDeckBottom: 'Unter Runendeck',
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

// Liest Name, Art, Farben und Signature aus dem Dateinamen, z. B. riven_unit_calm_3m-4p.webp
// Format: Name_Art_Farbe_Rest. Art und Farben dürfen in beliebiger Reihenfolge stehen, der Rest wird ignoriert.
// Zwei Farben (nur Legend oder Signature): viktor_legend_fury_mind.png. Signature-Karten: ahri-spell_spell_signature_mind_calm.png
// Im Namen steht - oder ein Leerzeichen für ein Leerzeichen (jinx-loose-cannon wird zu Jinx Loose Cannon).
const KIND_ALIASES = { bf: 'Battlefield' }
export function parseCardFilename(filename, defaults = {}) {
  const base = filename.replace(/\.[^.]+$/, '')
  const [rawName, ...rest] = base.split('_')
  const name = rawName.split(/[-\s]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  let kind = null
  let signature = false
  const colors = []
  for (const t of rest) {
    const k = t.toLowerCase()
    const kd = KINDS.find((x) => x.toLowerCase() === k) || KIND_ALIASES[k]
    const cl = COLORS.find((x) => x.toLowerCase() === k)
    if (k === 'signature' || k === 'sig') signature = true
    else if (kd && !kind) kind = kd
    else if (cl && colors.length < 2 && !colors.includes(cl)) colors.push(cl)
  }
  const kindFinal = kind || defaults.kind || 'Unit'
  const allowTwo = allowsSecondColor(kindFinal, signature)
  return {
    name: name || base,
    kind: kindFinal,
    color: colors[0] || defaults.color || null,
    color2: allowTwo ? colors[1] || null : null,
    signature,
    fromName: { kind: !!kind, color: colors.length > 0 },
  }
}

// Zweifarbige Karten gibt es nur bei Legends und Signature-Karten.
export const allowsSecondColor = (kind, signature) => String(kind || '').toLowerCase() === 'legend' || !!signature
// Alle Farben einer Karte (eine oder zwei)
export const colorsOf = (c) => [c?.color, c?.color2].filter(Boolean)

export const kindOf = (c) => (c?.kind || '').toLowerCase()

const uid = () => Math.random().toString(36).slice(2, 10)

// Mehrfach mischen (5 bis 8 Durchgänge), damit auch eine sortierte Ausgangsreihenfolge sicher durchmischt ist
export function shuffled(arr) {
  const r = [...arr]
  const passes = 5 + Math.floor(Math.random() * 4)
  for (let k = 0; k < passes; k++) {
    for (let i = r.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[r[i], r[j]] = [r[j], r[i]]
    }
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
  const allowed = legendColors(qty, byId)
  if (allowed.length) {
    const off = Object.entries(qty).filter(([id, n]) => n > 0 && byId[id] && kindOf(byId[id]) !== 'legend' && !fitsLegend(byId[id], allowed)).length
    if (off) r.problems.push(`${off} Karte(n) passen nicht zu den Legend-Farben (${allowed.join(' / ')})`)
  }
  r.valid = r.problems.length === 0
  return r
}

// Farben, die die gewählte Legend erlaubt (leer, solange keine Legend im Deck ist)
export function legendColors(qty, byId) {
  for (const [id, n] of Object.entries(qty)) if (n > 0 && kindOf(byId[id]) === 'legend') return colorsOf(byId[id])
  return []
}
// Passt die Karte zu den Legend-Farben? Karten ohne Farbe (Battlefields) passen immer; zweifarbige Karten brauchen beide Farben.
export const fitsLegend = (card, allowed) => !allowed.length || colorsOf(card).every((c) => allowed.includes(c))

// Gibt null zurück, wenn die Karte hinzugefügt werden darf, sonst den Grund.
export function canAdd(qty, byId, card) {
  const a = analyzeDeck(qty, byId)
  const k = kindOf(card)
  const R = DECK_RULES
  const allowed = k === 'legend' ? [] : legendColors(qty, byId)
  if (!fitsLegend(card, allowed)) return `Die Legend erlaubt nur ${allowed.join(' und ')}.`
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
  hand: [], base: [], battlefield: [], bfUnits: [], bfExtra: [], deck: [], runeDeck: [], legend: [], champion: [], runes: [], trash: [], banish: [], bfPool: [], stack: [],
})
const clone = (p) => JSON.parse(JSON.stringify(p))
export const isValidState = (s) => !!(s && s.zones && s.zones.base)
// Ältere Spielstände ohne Battlefield-Einheiten ergänzen
export function fixState(s) {
  if (!isValidState(s)) return null
  if (s.zones.bfUnits && s.zones.stack && s.zones.bfExtra) return s
  return { ...s, zones: { ...s.zones, bfUnits: s.zones.bfUnits || [], stack: s.zones.stack || [], bfExtra: s.zones.bfExtra || [] } }
}

export function buildPlayer(deck, cardsById, settings = DEFAULT_SETTINGS) {
  const zones = emptyZones()
  let champId = null
  for (const { card_id, qty, champion } of deck.cards || []) {
    const c = cardsById[card_id]
    if (!c) continue
    const k = kindOf(c)
    if (champion && qty > 0 && !['legend', 'battlefield', 'rune'].includes(k)) champId = card_id
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
  // Im Deck gespeicherter Champion (z. B. aus dem Import) kommt gleich in die Champion-Zone
  let champion = true
  if (champId) {
    const i = zones.deck.findIndex((c) => c.cardId === champId)
    if (i >= 0) { zones.champion.push(zones.deck.splice(i, 1)[0]); champion = false }
  }
  return {
    v: 4, points: 0, deckName: deck.name, zones, outbox: [],
    setup: { battlefield: zones.bfPool.length > 0 && zones.battlefield.length === 0, champion },
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

// Zonen, in denen eine Karte "im Spiel" ist (dort bleiben Tappen, Marken und verdeckt beim Verschieben erhalten)
const BOARD = ['base', 'bfUnits']
const isBoardTarget = (to) => to === 'base' || to.startsWith('bf:')
const PLAY = ['base', 'bfUnits', 'stack'] // hier bleiben Zielpfeile bestehen

// to: Zonenname, deckTop, deckBottom, runeDeckTop, runeDeckBottom, bf:<Sitz> (Battlefield-Feld) oder stack (gemeinsamer Stack).
// Index 0 = oben bei Decks, letzte Karte = oben im Trash/Banish.
// Angehängte Karten (att) wandern mit ihrer Hauptkarte mit, solange das Ziel im Spiel ist; sonst werden sie gelöst und bleiben liegen.
export function moveCard(p, instId, to, asKid = false) {
  const n = clone(p)
  const f = findInst(n, instId)
  if (!f) return p
  const valid = to.startsWith('bf:') || to === 'stack' || ['deckTop', 'deckBottom', 'runeDeckTop', 'runeDeckBottom'].includes(to)
    || (n.zones[to] && !['bfUnits', 'bfPool', 'stack', 'bfExtra'].includes(to))
  if (!valid) return p
  const kidIds = asKid ? [] : Object.values(n.zones).flat().filter((i) => i.att === instId).map((i) => i.id)
  const inst = take(n, instId)
  if (inst.token && !isBoardTarget(to) && to !== 'stack') { // Tokens verschwinden, sobald sie das Spielfeld verlassen
    let gone = n
    for (const kid of kidIds) { const k = findInst(gone, kid); if (k) { delete k.inst.att; delete k.inst.peek } }
    return gone
  }
  if (inst.floating && to !== 'runes') return n // Floating Energy verschwindet, sobald sie die Runenzone verlässt
  const boardMove = BOARD.includes(f.zone) && isBoardTarget(to)
  if (!boardMove) {
    inst.tapped = false
    delete inst.counters
    delete inst.status
  }
  if (!(PLAY.includes(f.zone) && (isBoardTarget(to) || to === 'stack'))) delete inst.targets
  // verdeckt bleibt nur beim Spielen auf Base/Battlefield bestehen (Hand → Tisch oder Tisch → Tisch)
  if (!isBoardTarget(to)) inst.faceDown = false
  delete inst.at
  delete inst.sts
  if (!asKid) { delete inst.att; delete inst.peek }
  if (to.startsWith('bf:')) { const key = to.slice(3); inst.at = /^\d+$/.test(key) ? Number(key) : key; n.zones.bfUnits.push(inst) }
  else if (to === 'stack') { inst.sts = Date.now(); n.zones.stack.push(inst) }
  else if (to === 'deckTop') n.zones.deck.unshift(inst)
  else if (to === 'deckBottom') n.zones.deck.push(inst)
  else if (to === 'runeDeckTop') n.zones.runeDeck.unshift(inst)
  else if (to === 'runeDeckBottom') n.zones.runeDeck.push(inst)
  else n.zones[to].push(inst)
  let out = n
  for (const kid of kidIds) {
    if (isBoardTarget(to)) out = moveCard(out, kid, to, true)
    else { const k = findInst(out, kid); if (k) { delete k.inst.att; delete k.inst.peek } }
  }
  return out
}

// ───────── Equipment: Karte unter eine andere Karte legen ─────────
export const PEEK_DEFAULT = 0.22
export function attachCard(p, instId, hostId) {
  const n = clone(p)
  const h = findInst(n, hostId)
  const f = findInst(n, instId)
  if (!h || !f || instId === hostId || !BOARD.includes(h.zone) || !BOARD.includes(f.zone) || h.inst.att) return p
  const kidIds = Object.values(n.zones).flat().filter((i) => i.att === instId).map((i) => i.id)
  const hostInst = h.inst
  for (const id of [instId, ...kidIds]) {
    const inst = take(n, id)
    inst.att = hostId
    inst.peek = inst.peek || PEEK_DEFAULT
    inst.tapped = !!hostInst.tapped
    delete inst.sts
    if (h.zone === 'bfUnits') inst.at = hostInst.at
    else delete inst.at
    n.zones[h.zone].push(inst)
  }
  return n
}
export function detachCard(p, instId) {
  const n = clone(p)
  const f = findInst(n, instId)
  if (!f) return p
  delete f.inst.att
  delete f.inst.peek
  return n
}
export function changePeek(p, instId, delta) {
  const n = clone(p)
  const f = findInst(n, instId)
  if (!f || !f.inst.att) return p
  f.inst.peek = Math.round(Math.min(0.6, Math.max(0.08, (f.inst.peek || PEEK_DEFAULT) + delta)) * 100) / 100
  return n
}

// Wohin darf eine Karte gezogen werden? Runen und Legend sind streng, alles andere frei.
// bfSeats: Sitze, deren Battlefield im Spiel ist (je ein Ziel bf:<Sitz>). inst wird gebraucht, um das aktuelle Feld auszuschließen.
// hostIds: eigene Karten im Spiel, an die man die Karte als Equipment hängen kann (Ziel card:<id>).
// 'deck' und 'runeDeck' sind ein einziges Ziel; ob oben oder unten, wird erst nach dem Loslassen gefragt.
export function targetsFor(card, zone, bfSeats = [], inst = null, hostIds = []) {
  const k = kindOf(card)
  let list
  if (inst?.floating) list = ['trash']
  else if (k === 'rune') list = zone === 'runes' ? ['runeDeck'] : []
  else if (zone === 'bfExtra') list = ['trash', ...(inst?.ovr ? bfSeats.map((s) => `bfov:${s}`) : [])]
  else if (isBfToken(card)) list = ['trash', ...(card.bf_mode === 'overlay' ? bfSeats.map((s) => `bfov:${s}`) : [])]
  else if (k === 'legend' || k === 'battlefield') list = []
  else {
    list = ['base', ...bfSeats.map((s) => `bf:${s}`), 'stack', 'hand', 'champion', 'trash', 'banish', 'deck']
    if (inst) list.push(...hostIds.filter((id) => id !== inst.id && id !== inst.att).map((id) => `card:${id}`))
  }
  const here = zone === 'bfUnits' && inst ? `bf:${inst.at}` : zone === 'bfExtra' && inst?.ovr ? `bfov:${inst.ovr}` : zone
  return list.filter((t) => t !== here)
}

const TAP_ZONES = ['base', 'bfUnits', 'champion', 'runes', 'legend']
export const canTap = (card, zone) => TAP_ZONES.includes(zone) && kindOf(card) !== 'battlefield'
// Zielpfeile und Übergabe: nur für Karten im Spiel
export const canAim = (zone) => ['base', 'bfUnits', 'stack', 'champion', 'battlefield', 'legend'].includes(zone)
export const canGive = (card, zone) => ['base', 'bfUnits'].includes(zone) && !['legend', 'battlefield', 'rune'].includes(kindOf(card))
// "Hide": nur in der Hand einstellbar, die Karte wird dann verdeckt gespielt. Aufdecken geschieht später auf dem Tisch.
export const canHide = (card, zone) => zone === 'hand' && !['legend', 'battlefield', 'rune'].includes(kindOf(card))
export const canReveal = (inst, zone) => !!inst?.faceDown && ['base', 'bfUnits', 'champion'].includes(zone)
// Marken (Buff, Schaden, Might, Status) gibt es für Karten im Spiel
export const canMark = (card, zone) => BOARD.includes(zone) && !['legend', 'battlefield', 'rune'].includes(kindOf(card))

export const COUNTERS = [
  { key: 'buff', label: 'Buff', min: 0 },
  { key: 'damage', label: 'Schaden', min: 0 },
  { key: 'might', label: 'Might', min: -9, signed: true },
  { key: 'marker', label: 'Marker', min: 0 },
]
export const STATUSES = [{ key: 'stunned', label: 'Stunned' }]

export function changeCounter(p, instId, key, delta) {
  const n = clone(p)
  const f = findInst(n, instId)
  const def = COUNTERS.find((c) => c.key === key)
  if (!f || !def) return p
  const c = { ...(f.inst.counters || {}) }
  const v = Math.min(99, Math.max(def.min, (c[key] || 0) + delta))
  if (v === 0) delete c[key]
  else c[key] = v
  if (Object.keys(c).length) f.inst.counters = c
  else delete f.inst.counters
  return n
}

export function toggleStatus(p, instId, key) {
  const n = clone(p)
  const f = findInst(n, instId)
  if (!f) return p
  const st = { ...(f.inst.status || {}) }
  if (st[key]) delete st[key]
  else st[key] = true
  if (Object.keys(st).length) f.inst.status = st
  else delete f.inst.status
  return n
}

export function clearMarks(p, instId) {
  const n = clone(p)
  const f = findInst(n, instId)
  if (!f) return p
  delete f.inst.counters
  delete f.inst.status
  return n
}

export function toggleFlag(p, instId, flag) {
  const n = clone(p)
  let f = findInst(n, instId)
  if (!f) return n
  if (f.inst.floating && flag === 'tapped') return moveCard(p, instId, 'trash') // Floating Energy ist verbraucht
  if (flag === 'tapped' && f.inst.att) f = findInst(n, f.inst.att) || f // angehängte Karten tappen mit ihrer Hauptkarte
  f.inst[flag] = !f.inst[flag]
  if (flag === 'tapped') for (const i of Object.values(n.zones).flat()) if (i.att === f.inst.id) i.tapped = f.inst.tapped
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
  for (const z of TAP_ZONES) (n.zones[z] || []).forEach((c) => (c.tapped = false))
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

// ───────── Gemeinsamer Stack ─────────
// Echte Karten (Spells) liegen in der Zone "stack" des Spielers, Effekte von Karten im Spiel als Verweis in p.fx.
// Der gemeinsame Stack ist die nach Zeit sortierte Summe aller Spieler; der letzte Eintrag liegt oben und wird zuerst aufgelöst.
export function stackEntries(players) {
  const list = []
  for (const pl of players) {
    for (const inst of pl.state?.zones.stack || []) list.push({ key: inst.id, seat: pl.seat, cardId: inst.cardId, inst, targets: inst.targets || [], sts: inst.sts || 0 })
    for (const fx of pl.state?.fx || []) list.push({ key: fx.id, seat: pl.seat, cardId: fx.cardId, fx, targets: fx.targets || [], sts: fx.sts || 0 })
  }
  return list.sort((a, b) => a.sts - b.sts || (a.key < b.key ? -1 : 1))
}
export const stackSig = (list) => list.map((e) => e.key).join('.')
export const approvedBy = (pl, sig) => !!sig && pl.state?.ok === sig
export function setApproval(p, sig, on) {
  const n = clone(p)
  if (on) n.ok = sig
  else delete n.ok
  return n
}
// Effekt einer Karte im Spiel auf den Stack legen (die Karte bleibt liegen, wird aber aufgedeckt)
export function addFx(p, instId, targetId) {
  const f = findInst(p, instId)
  if (!f || !['base', 'bfUnits', 'champion', 'legend'].includes(f.zone)) return p
  const n = clone(p)
  const g = findInst(n, instId)
  g.inst.faceDown = false
  n.fx = [...(n.fx || []), { id: 'fx' + uid(), instId, cardId: g.inst.cardId, sts: Date.now(), ...(targetId && targetId !== instId ? { targets: [targetId] } : {}) }]
  return n
}
// Karte spielen: Spells (und alles andere) liegen nur auf dem Stack, Einheiten/Ausrüstung kommen aufs Spielfeld und stehen zusätzlich im Stack.
export function playToStack(p, instId, targetId, cards, auto = {}) {
  const f = findInst(p, instId)
  if (!f) return p
  const k = kindOf(cards[f.inst.cardId])
  if (['unit', 'champion', 'token', 'gear'].includes(k)) {
    const entering = !BOARD.includes(f.zone)
    let n = entering ? moveCard(p, instId, 'base') : p
    const g = findInst(n, instId)
    if (g && g.inst.faceDown) n = toggleFlag(n, instId, 'faceDown')
    if (entering && auto.exhaust && entersTapped(cards[f.inst.cardId])) n = exhaust(n, instId)
    return addFx(n, instId, targetId)
  }
  const n = moveCard(p, instId, 'stack')
  const g = findInst(n, instId)
  if (g && targetId && targetId !== instId) g.inst.targets = [targetId]
  return n
}
// Obersten Eintrag auflösen: Effekt-Verweise verschwinden, Spells gehen in den Trash.
export function resolveEntry(p, entry) {
  if (entry.fx) {
    const n = clone(p)
    n.fx = (n.fx || []).filter((x) => x.id !== entry.fx.id)
    return n
  }
  return moveCard(p, entry.inst.id, 'trash')
}

// ───────── Zielpfeile ─────────
export function toggleTarget(p, instId, targetId) {
  const n = clone(p)
  const f = findInst(n, instId)
  if (!f || instId === targetId) return p
  const t = new Set(f.inst.targets || [])
  if (t.has(targetId)) t.delete(targetId)
  else t.add(targetId)
  if (t.size) f.inst.targets = [...t]
  else delete f.inst.targets
  return n
}
export function removeTarget(p, instId, targetId) {
  const n = clone(p)
  const f = findInst(n, instId)
  if (!f) return p
  f.inst.targets = (f.inst.targets || []).filter((x) => x !== targetId)
  if (!f.inst.targets.length) delete f.inst.targets
  return n
}
export function clearTargets(p, instId) {
  const n = clone(p)
  const f = findInst(n, instId)
  if (f) delete f.inst.targets
  return n
}

// ───────── Karte einem Mitspieler übergeben ─────────
// Der Besitzer legt sie mit Ziel-Sitz in seine "outbox", der Empfänger übernimmt sie (acceptGift) und der Geber räumt dann auf (dropGift).
export function giveCard(p, instId, toSeat) {
  const n = clone(p)
  const f = findInst(n, instId)
  if (!f || !['base', 'bfUnits'].includes(f.zone)) return p
  const ids = [instId, ...Object.values(n.zones).flat().filter((i) => i.att === instId).map((i) => i.id)] // Equipment geht mit
  for (const id of ids) {
    const g = findInst(n, id)
    const inst = take(n, id)
    delete inst.targets
    if (id === instId) { delete inst.att; delete inst.peek }
    n.outbox = [...(n.outbox || []), { to: toSeat, zone: g.zone, inst }]
  }
  return n
}
export function acceptGift(p, gift) {
  if (findInst(p, gift.inst.id)) return p
  const n = clone(p)
  n.zones[gift.zone === 'bfUnits' ? 'bfUnits' : 'base'].push({ ...gift.inst })
  return n
}
export function dropGift(p, instId) {
  const n = clone(p)
  n.outbox = (n.outbox || []).filter((g) => g.inst.id !== instId)
  return n
}
// Zurücknehmen, falls der Empfänger nicht reagiert
export function takeBackGifts(p) {
  let n = clone(p)
  const back = n.outbox || []
  n.outbox = []
  for (const g of back) n = acceptGift(n, g)
  return n
}

// ───────── Oberste Karten ansehen / kurz zeigen ─────────
export function showCards(p, cardIds) {
  const n = clone(p)
  n.shown = { cardIds, at: Date.now() }
  return n
}

// ───────── Deckliste importieren ─────────
// Format: Abschnitte "Legend:", "Champion:", "MainDeck:", "Battlefields:", "Runes:", "Sideboard:" und Zeilen "3 Kartenname".
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’'`´]/g, "'").replace(/\s+/g, ' ').trim()
// Schlüssel für den Namensvergleich: nur Buchstaben und Ziffern, damit "Leona, Zealot", "Leona - Zealot" und "Leona Zealot" gleich sind.
// Klammern und Codes dahinter wie "(OGN-123)" oder "[OGN]" werden ignoriert.
const nameKey = (s) => norm(s).replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/['’`´]/g, '').replace(/[^a-z0-9]+/g, '')
const nameParts = (s) => norm(s).replace(/\(.*?\)|\[.*?\]/g, ' ').split(/\s*(?:,|\s[-–—]\s|\||\/|:)\s*/).map(nameKey).filter((x) => x.length >= 3)
export function parseDeckList(text, allCards) {
  const byName = new Map()
  for (const c of allCards) {
    const key = nameKey(c.name)
    if (!byName.has(key)) byName.set(key, [])
    byName.get(key).push(c)
  }
  const SECTIONS = { legend: 'legend', champion: 'champion', 'main deck': 'main', maindeck: 'main', main: 'main', deck: 'main', battlefields: 'battlefield', battlefield: 'battlefield', runes: 'rune', rune: 'rune', sideboard: 'side', side: 'side' }
  const LABEL = { legend: 'Legend', champion: 'Champion', main: 'MainDeck', battlefield: 'Battlefields', rune: 'Runes' }
  const KIND_OF = { legend: ['legend'], champion: null, main: null, battlefield: ['battlefield'], rune: ['rune'] }
  const qty = {}
  const missing = []
  let champion = null
  let side = 0
  let section = 'main'
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const head = line.match(/^([A-Za-z ]+):$/)
    if (head) { section = SECTIONS[head[1].toLowerCase().trim()] || section; continue }
    const m = line.match(/^(\d+)\s*[x×]?\s+(.+)$/i)
    if (!m) { missing.push(line); continue }
    const n = Number(m[1])
    const name = m[2].trim()
    if (section === 'side') { side += n; continue }
    const nk = nameKey(name)
    let pool = byName.get(nk) || []
    if (!pool.length && nk.length >= 4) { // unscharf: Anfang des Namens oder nur ein Teil davor/nach Komma bzw. Bindestrich, aber nur bei eindeutigem Treffer
      const uniq = (hits) => new Set(hits.map((c) => nameKey(c.name))).size === 1
      let hits = allCards.filter((c) => { const k = nameKey(c.name); return k.startsWith(nk) || nk.startsWith(k) })
      if (!hits.length || !uniq(hits)) {
        const mine = nameParts(name)
        hits = allCards.filter((c) => nameParts(c.name).some((x) => mine.includes(x)))
      }
      if (hits.length && uniq(hits)) pool = hits
    }
    if (section === 'rune' && !pool.length) {
      // "6 Calm Rune": über die Farbe suchen
      const col = COLORS.find((c) => norm(name).replace(/\s*runes?$/, '') === c.toLowerCase())
      if (col) pool = allCards.filter((c) => kindOf(c) === 'rune' && c.color === col)
    }
    const want = KIND_OF[section]
    let found
    if (want) found = pool.find((c) => want.includes(kindOf(c)))
    else found = pool.find((c) => !['legend', 'battlefield', 'rune'].includes(kindOf(c)))
    if (!found && pool.length) found = pool[0] // richtiger Name, aber andere Art als der Abschnitt vermuten lässt
    if (!found) { missing.push(`${n}× ${name} (${LABEL[section] || section})`); continue }
    qty[found.id] = (qty[found.id] || 0) + n
    if (section === 'champion') champion = found.id
  }
  return { qty, champion, missing, side }
}
// Deck als Text (gleiches Format wie der Import)
export function formatDeckList(qty, byId, champion) {
  const lines = { Legend: [], Champion: [], MainDeck: [], Battlefields: [], Runes: [] }
  for (const [id, n] of Object.entries(qty)) {
    const c = byId[id]
    if (!c || n <= 0) continue
    const k = kindOf(c)
    if (k === 'legend') lines.Legend.push(`${n} ${c.name}`)
    else if (k === 'battlefield') lines.Battlefields.push(`${n} ${c.name}`)
    else if (k === 'rune') lines.Runes.push(`${n} ${c.name}`)
    else if (id === champion) {
      lines.Champion.push(`1 ${c.name}`)
      if (n > 1) lines.MainDeck.push(`${n - 1} ${c.name}`)
    } else lines.MainDeck.push(`${n} ${c.name}`)
  }
  return Object.entries(lines).filter(([, l]) => l.length).map(([h, l]) => `${h}:\n${l.join('\n')}`).join('\n\n')
}


// ───────── Kosten bezahlen, Einheiten tappen, Tokens ─────────
// Energy = Runen tappen, Power = Runen der passenden Farbe recyceln (unter das Runendeck). Ohne bekannte Kosten passiert nichts.
export function costOf(card) {
  if (!card || ['rune', 'legend', 'battlefield'].includes(kindOf(card))) return null
  if (card.energy == null && card.power == null) return null
  const power = card.power || 0
  const cols = String(card.power_colors || '').split(',').map((x) => x.trim()).filter(Boolean)
  return { energy: card.energy || 0, power, colors: power ? (cols.length ? cols : colorsOf(card)) : [] }
}
// Floating Energy: farblose Energy, die entsteht, wenn eine bereite (ungetappte) Rune recycelt wird. Sie liegt als Karte in der Runenzone.
export const FLOAT_ID = '__float'
const floatSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9aa4b2"/><stop offset="1" stop-color="#4b5563"/></linearGradient></defs><rect width="500" height="700" rx="36" fill="url(#g)"/><rect x="18" y="18" width="464" height="664" rx="26" fill="none" stroke="#e8edf5" stroke-width="6" stroke-dasharray="18 12"/><text x="250" y="320" font-size="150" text-anchor="middle" fill="#fff">✦</text><text x="250" y="430" font-size="52" font-weight="700" text-anchor="middle" fill="#fff" font-family="sans-serif">Floating</text><text x="250" y="495" font-size="52" font-weight="700" text-anchor="middle" fill="#fff" font-family="sans-serif">Energy</text></svg>`
export const FLOAT_CARD = { id: FLOAT_ID, name: 'Floating Energy', kind: 'Rune', color: null, image_url: 'data:image/svg+xml;utf8,' + encodeURIComponent(floatSvg) }

// Legend-Rabatt: manche Legends übernehmen einen Teil der Energy- oder Power-Kosten (im Karten-Verwalter einstellbar)
export function legendDiscount(legendCard, card, cost) {
  if (!legendCard || !cost) return { cost, saved: null }
  const e = legendCard.legend_energy || 0
  const pw = legendCard.legend_power || 0
  if (!e && !pw) return { cost, saved: null }
  const kinds = String(legendCard.legend_kinds || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)
  if (kinds.length && !kinds.includes(kindOf(card))) return { cost, saved: null }
  const saved = { energy: Math.min(e, cost.energy), power: Math.min(pw, cost.power), tap: legendCard.legend_tap !== false }
  if (!saved.energy && !saved.power) return { cost, saved: null }
  const power = cost.power - saved.power
  return { cost: { ...cost, energy: cost.energy - saved.energy, power, colors: power ? cost.colors : [] }, saved }
}

// Plan: welche Runen getappt und welche recycelt werden.
// Energy: zuerst Floating Energy, dann Runen in der Farbe der Karte (damit passende getappte Runen zum Recyceln da sind), dann beliebige.
// Power: zuerst bereits getappte Runen der passenden Farbe recyceln, dann die gerade für Energy getappten, zuletzt bereite (dabei entsteht Floating Energy).
// Bei zwei möglichen Power-Farben und freier Wahl kommt `choice` zurück.
export function planPayment(p, cost, cards, chosen) {
  const runes = p.zones.runes
  const col = (r) => cards[r.cardId]?.color
  const own = (r) => cost.colors.includes(col(r))
  const rank = (r) => (r.floating ? 0 : (chosen || []).includes(r.id) ? 1 : own(r) ? 2 : 3) // gewählte Power-Runen zuerst tappen: dann kostet das Recyceln keine Floating Energy
  const tap = runes.filter((r) => !r.tapped).sort((a, b) => rank(a) - rank(b)).slice(0, cost.energy).map((r) => r.id)
  let recycle = []
  if (cost.power > 0) {
    const cand = runes.filter((r) => !r.floating && cost.colors.includes(col(r)))
    const pref = (r) => (r.tapped ? 0 : tap.includes(r.id) ? 1 : 2)
    if (chosen) recycle = chosen.filter((id) => cand.some((r) => r.id === id)).slice(0, cost.power)
    else if (cost.colors.length < 2 || new Set(cand.map(col)).size < 2 || cand.length <= cost.power) {
      recycle = [...cand].sort((a, b) => pref(a) - pref(b)).slice(0, cost.power).map((r) => r.id)
    } else return { choice: { n: cost.power, candidates: cand.map((r) => r.id) } }
  }
  let floats = recycle.filter((id) => { const r = runes.find((x) => x.id === id); return !r.tapped && !tap.includes(id) }).length
  let missingEnergy = cost.energy - tap.length
  const use = Math.min(floats, missingEnergy) // frisch entstandene Floating Energy zahlt gleich noch fehlende Energy
  floats -= use
  missingEnergy -= use
  return { recycle, tap, floats, floatUsed: use, missingPower: cost.power - recycle.length, missingEnergy }
}
export function applyPayment(p, plan) {
  let n = clone(p)
  n.zones.runes = n.zones.runes.filter((r) => !(r.floating && plan.tap.includes(r.id)))
  for (const r of n.zones.runes) if (plan.tap.includes(r.id)) r.tapped = true
  for (const id of plan.recycle) n = moveCard(n, id, 'runeDeckBottom')
  for (let i = 0; i < (plan.floats || 0); i++) n.zones.runes.push({ id: uid(), cardId: FLOAT_ID, tapped: false, faceDown: false, floating: true })
  return n
}
// Karte tappen (falls noch nicht getappt), inklusive angehängtem Equipment
export function exhaust(p, instId) {
  const f = findInst(p, instId)
  return f && !f.inst.tapped ? toggleFlag(p, instId, 'tapped') : p
}
// Ob eine Karte getappt ins Spiel kommt: im Karten-Verwalter einstellbar (enters_ready), sonst Einheiten, Champions, Gear und Tokens getappt, Spells ready.
export function entersTapped(card) {
  const k = kindOf(card)
  if (!card || ['spell', 'battlefield', 'legend', 'rune', 'other'].includes(k)) return false
  if (card.enters_ready === true) return false
  if (card.enters_ready === false) return true
  if (k === 'token' && ['battlefield', 'spell'].includes(String(card.token_type || '').toLowerCase())) return false
  return true
}
const unitLike = (card) => ['unit', 'champion'].includes(kindOf(card)) || (kindOf(card) === 'token' && ['', 'unit'].includes(String(card.token_type || '').toLowerCase()))
// Karten treten getappt ins Spiel (je nach Einstellung der Karte); Einheiten tappen außerdem beim Zug vom Base auf ein Battlefield
export function moveAuto(p, instId, to, cards, auto = {}) {
  const f = findInst(p, instId)
  if (!f) return p
  const n = moveCard(p, instId, to)
  if (!auto.exhaust) return n
  const card = cards[f.inst.cardId]
  const enters = (f.zone === 'hand' || f.zone === 'champion') && isBoardTarget(to) && entersTapped(card)
  const moves = f.zone === 'base' && to.startsWith('bf:') && unitLike(card)
  return enters || moves ? exhaust(n, instId) : n
}
export const isBfToken = (card) => kindOf(card) === 'token' && String(card?.token_type || '').toLowerCase() === 'battlefield'
// Token ins Spiel bringen: `count` neue Karten im Base (getappt, falls die Karte so eingestellt ist), mit allen Eigenschaften normaler Karten.
// Battlefield-Token mit Modus "extra" bilden ein zusätzliches Battlefield, solche mit "overlay" liegen erst im Base und werden auf ein Battlefield gezogen.
export function spawnTokens(p, card, count = 1, auto = {}) {
  const n = clone(p)
  const tapped = auto.exhaust !== false && entersTapped(card)
  for (let i = 0; i < count; i++) {
    const inst = { id: uid(), cardId: card.id, tapped, faceDown: false, token: true }
    if (isBfToken(card) && card.bf_mode !== 'overlay') { inst.tapped = false; n.zones.bfExtra.push(inst) } else n.zones.base.push(inst)
  }
  return n
}
// Overlay-Battlefield leicht versetzt über ein Battlefield legen (key = Sitz oder Zusatz-Battlefield "x<id>")
export function overlayBattlefield(p, instId, key) {
  const n = clone(p)
  const inst = take(n, instId)
  if (!inst) return p
  inst.ovr = String(key)
  inst.tapped = false
  delete inst.at
  n.zones.bfExtra.push(inst)
  return n
}
export function setPoints(p, v) {
  const n = clone(p)
  n.points = Math.max(0, Math.min(99, Math.round(v)))
  return n
}
// Unterste Karte des Decks auf die Hand bzw. des Runendecks in die Runenzone
export function drawBottom(p) {
  const n = clone(p)
  if (n.zones.deck.length) n.zones.hand.push(n.zones.deck.pop())
  return n
}
export function drawRuneBottom(p) {
  const n = clone(p)
  if (n.zones.runeDeck.length) n.zones.runes.push(n.zones.runeDeck.pop())
  return n
}

// Buff-Token auf einer Einheit zählt automatisch den Buff-Zähler hoch, fällt er weg, geht der Zähler wieder herunter (nie unter 0).
// `buffTok` merkt sich, wie viele Buff-Tokens schon eingerechnet sind. Gibt dasselbe Objekt zurück, wenn nichts zu tun ist.
export const isBuffToken = (card) => kindOf(card) === 'token' && /^\s*buff\b/i.test(card?.name || '')
export function syncBuffs(p, cards) {
  if (!p || !cards) return p
  const all = Object.values(p.zones).flat()
  const count = {}
  for (const i of all) if (i.att && isBuffToken(cards[i.cardId])) count[i.att] = (count[i.att] || 0) + 1
  const dirty = all.some((i) => (count[i.id] || 0) !== (i.buffTok || 0))
  if (!dirty) return p
  const n = clone(p)
  for (const i of Object.values(n.zones).flat()) {
    const now = count[i.id] || 0
    const was = i.buffTok || 0
    if (now === was) continue
    const cur = (i.counters || {}).buff || 0
    const next = Math.max(0, cur + now - was)
    if (next) i.counters = { ...(i.counters || {}), buff: next }
    else if (i.counters) { delete i.counters.buff; if (!Object.keys(i.counters).length) delete i.counters }
    if (now) i.buffTok = now; else delete i.buffTok
  }
  return n
}
