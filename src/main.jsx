import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './style.css'

// Zeigt bei einem Absturz die Fehlermeldung statt einer leeren Seite
class Boundary extends React.Component {
  state = { err: null }
  static getDerivedStateFromError(err) { return { err } }
  render() {
    if (!this.state.err) return this.props.children
    return (
      <div className="center stack" style={{ padding: 24, textAlign: 'center' }}>
        <p>Es ist ein Fehler aufgetreten.</p>
        <p className="muted small">{String(this.state.err?.message || this.state.err)}</p>
        <button onClick={() => location.reload()}>Neu laden</button>
      </div>
    )
  }
}

createRoot(document.getElementById('root')).render(<Boundary><App /></Boundary>)
