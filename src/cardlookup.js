import { KINDS, COLORS, allowsSecondColor } from './game'

// Erkennt Dateinamen wie SFD-042.webp, ogn_011_298.png oder "OGN 011": Set-Kürzel + Kartennummer.
export function parseSetNumber(filename) {
  const base = filename.replace(/\.[^.]+$/, '')
  const m = base.match(/^([a-z]{2,4})[\s_-]*0*(\d{1,3})(?:[\s_-]|$)/i)
  if (!m) return null
  return { set: m[1].toLowerCase(), num: m[2].padStart(3, '0') }
}

const cache = new Map()

// Fragt die offene Riftcodex-Datenbank (api.riftcodex.com, kein Schlüssel nötig) nach einer Karte.
export async function fetchCardInfo(set, num) {
  const key = `${set}-${num}`
  if (cache.has(key)) return cache.get(key)
  const res = await fetch(`https://api.riftcodex.com/cards/riftbound/${key}`)
  if (res.status === 404) { cache.set(key, null); return null } // Karte gibt es dort nicht
  if (!res.ok) throw new Error(`Riftcodex antwortet mit ${res.status}`)
  const data = await res.json()
  const list = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : data?.name ? [data] : []
  // Teil-Treffer erlaubt (sfd-042 findet sfd-042-221); bevorzugt die normale Version statt Alternativ-Art
  const match = list.filter((c) => (c.riftbound_id || '').toLowerCase().startsWith(key))
  const card = match.find((c) => !c.metadata?.alternate_art && !c.metadata?.overnumbered) || match[0] || null
  cache.set(key, card)
  return card
}

const normKind = (s) => {
  const t = String(s || '').toLowerCase()
  if (!t) return null
  return KINDS.find((k) => k.toLowerCase() === t) || KINDS.find((k) => k !== 'Other' && t.includes(k.toLowerCase())) || null
}

// Übersetzt einen Riftcodex-Eintrag in unsere Felder.
// Signature-Karten sind dort keine eigene Art: sie werden über metadata.signature (oder die Oberart) erkannt.
export function mapApiCard(c) {
  const type = c.classification?.type || ''
  const sup = c.classification?.supertype || ''
  const signature = c.metadata?.signature === true || /signature/i.test(sup)
  let kind
  if (/token/i.test(sup)) kind = 'Token'
  else if (/champion/i.test(sup) && normKind(type) === 'Unit') kind = 'Champion'
  else kind = normKind(type) || normKind(sup) || 'Other'
  const domains = (c.classification?.domain || []).map((d) => COLORS.find((x) => x.toLowerCase() === String(d).toLowerCase())).filter(Boolean)
  const twoOk = allowsSecondColor(kind, signature)
  return {
    name: c.name,
    kind,
    signature,
    color: domains[0] || null,
    color2: twoOk ? domains[1] || null : null,
    domains,
    ignoredDomain: !twoOk && domains.length > 1 ? domains[1] : null, // zweite Farbe, die wir nicht übernehmen
    code: (c.riftbound_id || '').split('-').slice(0, 2).join('-').toUpperCase() || null,
  }
}
