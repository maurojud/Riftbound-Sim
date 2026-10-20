import { useState } from 'react'

// Zeigt ein Kartenbild. Battlefield-Karten werden immer quer (7:5) angezeigt: liegt das Bild hochkant vor, wird es um 90° gedreht.
// Die Drehrichtung steht in der CSS-Variable --bfrot (Standard 90deg, umstellbar unter Mehr > Ansicht).
export default function CardImg({ src, alt = '', battlefield, className = '', ...rest }) {
  const [portrait, setPortrait] = useState(false)
  if (!battlefield) return <img className={className} src={src} alt={alt} draggable={false} decoding="async" {...rest} />
  return (
    <div className={'bfimg' + (portrait ? ' portrait' : '')}>
      <img className={className} src={src} alt={alt} draggable={false} decoding="async" {...rest}
        onLoad={(e) => setPortrait(e.currentTarget.naturalHeight > e.currentTarget.naturalWidth)} />
    </div>
  )
}

export function applyBfRotation() {
  let v = '90'
  try { v = localStorage.getItem('rt:bfrot') === '-90' ? '-90' : '90' } catch { /* ohne Speicher */ }
  document.documentElement.style.setProperty('--bfrot', v + 'deg')
  return v
}
export function setBfRotation(v) {
  try { localStorage.setItem('rt:bfrot', v) } catch { /* ohne Speicher */ }
  return applyBfRotation()
}
