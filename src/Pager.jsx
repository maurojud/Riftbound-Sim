import { useEffect, useState } from 'react'

export const PAGE_SIZES = [30, 50, 100, 200]

// Seitengröße wird pro Bereich gemerkt (nur als Komfort, funktioniert auch ohne localStorage)
export function usePaging(storeKey, resetDeps) {
  const [page, setPage] = useState(0)
  const [size, setSizeState] = useState(() => {
    try { const v = Number(localStorage.getItem('rt:psize:' + storeKey)); return PAGE_SIZES.includes(v) ? v : 50 } catch { return 50 }
  })
  const setSize = (n) => { setSizeState(n); setPage(0); try { localStorage.setItem('rt:psize:' + storeKey, String(n)) } catch { /* egal */ } }
  useEffect(() => { setPage(0) }, resetDeps) // eslint-disable-line react-hooks/exhaustive-deps
  return { page, setPage, size, setSize }
}

export const pageSlice = (list, { page, size }) => {
  const last = Math.max(0, Math.ceil(list.length / size) - 1)
  const p = Math.min(page, last)
  return { items: list.slice(p * size, p * size + size), page: p, last }
}

export default function Pager({ total, paging }) {
  const { page, setPage, size, setSize } = paging
  const last = Math.max(0, Math.ceil(total / size) - 1)
  const p = Math.min(page, last)
  const from = total ? p * size + 1 : 0
  const to = Math.min(total, p * size + size)
  return (
    <div className="pager" role="navigation" aria-label="Seiten">
      <label>Pro Seite
        <select value={size} onChange={(e) => setSize(Number(e.target.value))}>
          {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <button disabled={p <= 0} onClick={() => setPage(0)} title="Erste Seite">«</button>
      <button disabled={p <= 0} onClick={() => setPage(p - 1)}>‹ Zurück</button>
      <span className="pageinfo">Seite {p + 1} von {last + 1} · {from}–{to} von {total}</span>
      <button disabled={p >= last} onClick={() => setPage(p + 1)}>Weiter ›</button>
      <button disabled={p >= last} onClick={() => setPage(last)} title="Letzte Seite">»</button>
    </div>
  )
}
