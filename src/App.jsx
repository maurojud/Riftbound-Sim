import { lazy, Suspense, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { go, useHash } from './nav'
import Auth from './Auth'
import Home from './Home'
import Session from './Session'
const DeckBuilder = lazy(() => import('./DeckBuilder'))
const Admin = lazy(() => import('./Admin'))

export default function App() {
  const [auth, setAuth] = useState(undefined)
  const [profile, setProfile] = useState(null)
  const hash = useHash()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setAuth(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setAuth(s))
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!auth) return setProfile(null)
    supabase.from('profiles').select('*').eq('id', auth.user.id).maybeSingle().then(({ data }) => setProfile(data))
  }, [auth?.user?.id])

  if (auth === undefined) return <div className="center">Lade…</div>
  if (!auth) return <Auth />

  const user = {
    id: auth.user.id,
    username: profile?.username || auth.user.email,
    isAdmin: !!profile?.is_admin,
  }
  const [, a, b, c] = hash.split('/')

  if (a === 's' && b) return <Session id={b} view={c || 'play'} user={user} />

  return (
    <div className="shell">
      <nav className="nav">
        <strong className="brand" onClick={() => go('/')}>Riftbound Table</strong>
        <button className="link" onClick={() => go('/')}>Spielen</button>
        <button className="link" onClick={() => go('/decks')}>Decks</button>
        {user.isAdmin && <button className="link" onClick={() => go('/admin')}>Karten verwalten</button>}
        <span className="spacer" />
        <span className="muted">{user.username}</span>
        <button className="link" onClick={() => supabase.auth.signOut()}>Abmelden</button>
      </nav>
      <main className="page"><Suspense fallback={<div className="center">Lade…</div>}>
        {a === 'decks' ? <DeckBuilder user={user} /> :
         a === 'admin' ? <Admin user={user} /> :
         <Home user={user} joinCode={a === 'join' ? b : ''} />}
      </Suspense></main>
    </div>
  )
}
