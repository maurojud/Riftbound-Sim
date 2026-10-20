import { createClient } from '@supabase/supabase-js'

const strip = (s = '') => s.trim().replace(/^["']|["']$/g, '')

function cleanUrl(u) {
  let url = strip(u)
  if (url && !/^https?:\/\//.test(url)) url = 'https://' + url
  const m = url.match(/^https?:\/\/[^/\s]+/) // nur die Hauptadresse behalten
  return m ? m[0] : url
}

const url = cleanUrl(import.meta.env.VITE_SUPABASE_URL)
const key = strip(import.meta.env.VITE_SUPABASE_ANON_KEY)

export const supabase = createClient(url || 'http://localhost', key || 'missing-key')
export const configured = !!url

// Supabase liefert pro Abfrage höchstens 1000 Zeilen. Karten daher seitenweise holen, bis alle da sind.
export async function fetchAllCards(orderBy = 'created_at', ascending = false) {
  const PAGE = 1000
  const all = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from('cards').select('*').order(orderBy, { ascending }).order('id').range(from, from + PAGE - 1)
    if (error) return { data: all, error }
    all.push(...(data || []))
    if (!data || data.length < PAGE) break
  }
  return { data: all, error: null }
}

// Karten stehen sofort aus dem Zwischenspeicher bereit (Browser); im Hintergrund wird aktualisiert.
const CK = 'rt:cards:v1'
export function cachedCards() {
  try { const c = JSON.parse(localStorage.getItem(CK) || 'null'); return Array.isArray(c) ? c : null } catch { return null }
}
export async function loadCards(onFresh) {
  const cached = cachedCards()
  const fresh = fetchAllCardsFast().then(({ data, error }) => {
    if (!error && data.length) { try { localStorage.setItem(CK, JSON.stringify(data)) } catch { /* Speicher voll */ } }
    onFresh?.(error ? cached || [] : data)
    return data
  })
  return { cached, fresh }
}
// holt alle Seiten gleichzeitig, sobald die Anzahl bekannt ist
export async function fetchAllCardsFast() {
  const PAGE = 1000
  const head = await supabase.from('cards').select('*', { count: 'exact', head: true })
  if (head.error || head.count == null || head.count <= PAGE) return fetchAllCards()
  const pages = Math.ceil(head.count / PAGE)
  const res = await Promise.all(Array.from({ length: pages }, (_, i) => supabase.from('cards').select('*').order('created_at', { ascending: false }).order('id').range(i * PAGE, i * PAGE + PAGE - 1)))
  const err = res.find((r) => r.error)
  return { data: res.flatMap((r) => r.data || []), error: err?.error || null }
}
export const dropCardCache = () => { try { localStorage.removeItem(CK) } catch { /* egal */ } }
