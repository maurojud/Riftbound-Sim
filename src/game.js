// Spiellogik ohne Regel-Engine: Zonen, Karteninstanzen und Aktionen. Was erlaubt ist, steuern nur die Zonen-Optionen unten.
export const ZONES = {
  hand: 'Hand',
  base: 'Base',
  battlefield: 'Battlefield',
  bfUnits: 'Battlefield',
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
  hand: [], base: [], battlefield: [], bfUnits: [], deck: [], runeDeck: [], legend: [], champion: [], runes: [], trash: [], banish: [], bfPool: [], stack: [],
})
const clone = (p) => JSON.parse(JSON.stringify(p))
export const isValidState = (s) => !!(s && s.zones && s.zones.base)
// Ältere Spielstände ohne Battlefield-Einheiten ergänzen
export function fixState(s) {
  if (!isValidState(s)) return null
  if (s.zones.bfUnits && s.zones.stack) return s
  return { ...s, zones: { ...s.zones, bfUnits: s.zones.bfUnits || [], stack: s.zones.stack || [] } }
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

// to: Zonenname, deckTop, deckBottom, runeDeckTop, runeDeckBottom, bf:<Sitz> (Battlefield-Feld) oder stack:<Sitz> (Stack dieses Battlefields).
// Index 0 = oben bei Decks, letzte Karte = oben im Trash/Banish.
export function moveCard(p, instId, to) {
  const n = clone(p)
  const f = findInst(n, instId)
  if (!f) return p
  const valid = to.startsWith('bf:') || to.startsWith('stack:') || ['deckTop', 'deckBottom', 'runeDeckTop', 'runeDeckBottom'].includes(to)
    || (n.zones[to] && !['bfUnits', 'bfPool', 'stack'].includes(to))
  if (!valid) return p
  const inst = take(n, instId)
  const boardMove = BOARD.includes(f.zone) && isBoardTarget(to)
  if (!boardMove) {
    inst.tapped = false
    delete inst.counters
    delete inst.status
  }
  if (!(PLAY.includes(f.zone) && (isBoardTarget(to) || to.startsWith('stack:')))) delete inst.targets
  // verdeckt bleibt nur beim Spielen auf Base/Battlefield bestehen (Hand → Tisch oder Tisch → Tisch)
  if (!isBoardTarget(to)) inst.faceDown = false
  delete inst.at
  delete inst.sts
  if (to.startsWith('bf:')) { inst.at = Number(to.slice(3)); n.zones.bfUnits.push(inst) }
  else if (to.startsWith('stack:')) { inst.at = Number(to.slice(6)); inst.sts = Date.now(); n.zones.stack.push(inst) }
  else if (to === 'deckTop') n.zones.deck.unshift(inst)
  else if (to === 'deckBottom') n.zones.deck.push(inst)
  else if (to === 'runeDeckTop') n.zones.runeDeck.unshift(inst)
  else if (to === 'runeDeckBottom') n.zones.runeDeck.push(inst)
  else n.zones[to].push(inst)
  return n
}

// Wohin darf eine Karte gezogen werden? Runen und Legend sind streng, alles andere frei.
// bfSeats: Sitze, deren Battlefield im Spiel ist (je ein Ziel bf:<Sitz> und stack:<Sitz>). inst wird gebraucht, um das aktuelle Feld auszuschließen.
// 'deck' und 'runeDeck' sind ein einziges Ziel; ob oben oder unten, wird erst nach dem Loslassen gefragt.
export function targetsFor(card, zone, bfSeats = [], inst = null) {
  const k = kindOf(card)
  let list
  if (k === 'rune') list = zone === 'runes' ? ['runeDeck'] : []
  else if (k === 'legend' || k === 'battlefield') list = []
  else list = ['base', ...bfSeats.map((s) => `bf:${s}`), ...bfSeats.map((s) => `stack:${s}`), 'hand', 'champion', 'trash', 'banish', 'deck']
  const here = zone === 'bfUnits' && inst ? `bf:${inst.at}` : zone === 'stack' && inst ? `stack:${inst.at}` : zone
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

// ───────── Stack pro Battlefield ─────────
// Jeder Spieler legt seine Stack-Karten in der eigenen Zone "stack" ab (mit at = Sitz des Battlefields, sts = Zeit).
// Der gemeinsame Stack ist die nach Zeit sortierte Summe aller Spieler. Ganz oben (letzter Eintrag) wird zuerst aufgelöst.
export function stackFor(players, bSeat) {
  const list = []
  for (const pl of players) for (const inst of pl.state?.zones.stack || []) if (inst.at === bSeat) list.push({ inst, seat: pl.seat })
  return list.sort((a, b) => (a.inst.sts || 0) - (b.inst.sts || 0) || (a.inst.id < b.inst.id ? -1 : 1))
}
export const stackSig = (list) => list.map((e) => e.inst.id).join('.')
export const approvedBy = (pl, bSeat, sig) => !!sig && pl.state?.ok?.[bSeat] === sig
export function setApproval(p, bSeat, sig, on) {
  const n = clone(p)
  n.ok = { ...(n.ok || {}) }
  if (on) n.ok[bSeat] = sig
  else delete n.ok[bSeat]
  return n
}
// Auflösen: Spells und Sonstiges gehen in den Trash, Einheiten aufs Battlefield, Ausrüstung in die Base. Zielpfeile verschwinden.
export function resolveStackCard(p, instId, bSeat, cards) {
  const f = findInst(p, instId)
  if (!f) return p
  const k = kindOf(cards[f.inst.cardId])
  const to = ['unit', 'champion', 'token'].includes(k) ? `bf:${bSeat}` : k === 'gear' ? 'base' : 'trash'
  const n = moveCard(p, instId, to)
  const g = findInst(n, instId)
  if (g) delete g.inst.targets
  return n
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
  const inst = take(n, instId)
  delete inst.targets
  n.outbox = [...(n.outbox || []), { to: toSeat, zone: f.zone, inst }]
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
export function parseDeckList(text, allCards) {
  const byName = new Map()
  for (const c of allCards) {
    const key = norm(c.name)
    if (!byName.has(key)) byName.set(key, [])
    byName.get(key).push(c)
  }
  const SECTIONS = { legend: 'legend', champion: 'champion', 'main deck': 'main', maindeck: 'main', main: 'main', deck: 'main', battlefields: 'battlefield', battlefield: 'battlefield', runes: 'rune', rune: 'rune', sideboard: 'side', side: 'side' }
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
    let pool = byName.get(norm(name)) || []
    if (section === 'rune' && !pool.length) {
      // "6 Calm Rune": über die Farbe suchen
      const col = COLORS.find((c) => norm(name).replace(/\s*runes?$/, '') === c.toLowerCase())
      if (col) pool = allCards.filter((c) => kindOf(c) === 'rune' && c.color === col)
    }
    const want = KIND_OF[section]
    let found
    if (want) found = pool.find((c) => want.includes(kindOf(c)))
    else found = pool.find((c) => !['legend', 'battlefield', 'rune'].includes(kindOf(c)))
    if (!found) { missing.push(`${n} ${name}`); continue }
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
