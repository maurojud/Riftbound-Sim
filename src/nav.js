import { useEffect, useState } from 'react'

export const go = (path) => { location.hash = path }

export function useHash() {
  const read = () => location.hash.slice(1) || '/'
  const [h, setH] = useState(read)
  useEffect(() => {
    const f = () => setH(read())
    addEventListener('hashchange', f)
    return () => removeEventListener('hashchange', f)
  }, [])
  return h
}
