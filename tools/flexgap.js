// PostCSS-Plugin: ersetzt "gap" bei Flexbox (erst ab Chrome 84) durch Außenabstände – nur für ältere Browser (z. B. Samsung-Fernseher bis 2021).
// Moderne Browser lesen den Block nicht, weil er hinter "@supports not (width: min(1px, 2px))" liegt.
export const OLD = 'not (width: min(1px, 2px))'
export default function flexgap() {
  return {
    postcssPlugin: 'flexgap',
    OnceExit(root, { AtRule, Rule }) {
      const inKeyframes = (n) => { for (let p = n.parent; p; p = p.parent) if (p.type === 'atrule' && /keyframes$/.test(p.name)) return true; return false }
      const info = {}
      const read = (r) => {
        const o = {}
        r.each((d) => {
          if (d.type !== 'decl') return
          if (d.prop === 'display') o.display = d.value
          if (d.prop === 'flex-wrap') o.wrap = d.value !== 'nowrap'
          if (d.prop === 'flex-direction') o.col = /column/.test(d.value)
          if (d.prop === 'gap' || d.prop === 'grid-gap') { const [a, b] = d.value.trim().split(/\s+(?![^(]*\))/); o.row = a; o.colGap = b || a }
          if (d.prop === 'row-gap') o.row = d.value
          if (d.prop === 'column-gap') o.colGap = d.value
        })
        return o
      }
      root.walkRules((r) => {
        if (inKeyframes(r)) return
        const o = read(r)
        for (const s of r.selectors) {
          const i = (info[s] ||= { disp: new Set() })
          if (o.display) i.disp.add(/grid/.test(o.display) ? 'grid' : /flex/.test(o.display) ? 'flex' : 'other')
          if (o.wrap) i.wrap = true
          if (o.col) i.col = true
        }
      })
      const groups = new Map() // Medienbedingung -> Regeln
      root.walkRules((r) => {
        if (inKeyframes(r)) return
        const o = read(r)
        if (o.row == null && o.colGap == null) return
        const media = []
        for (let p = r.parent; p && p.type === 'atrule'; p = p.parent) if (p.name === 'media') media.unshift(p.params)
        const key = media.join(' ## ')
        for (const s of r.selectors) {
          const i = info[s] || { disp: new Set() }
          const disp = o.display ? (/grid/.test(o.display) ? 'grid' : /flex/.test(o.display) ? 'flex' : 'other') : null
          const isFlex = disp ? disp === 'flex' : i.disp.has('flex') && !i.disp.has('grid')
          if (!isFlex) continue
          const wrap = o.wrap || i.wrap
          const col = o.col || i.col
          const rg = o.row ?? o.colGap, cg = o.colGap ?? o.row
          const rule = new Rule({ selector: wrap ? `${s} > *` : `${s} > * + *` })
          if (wrap) rule.append({ prop: 'margin', value: `0 ${cg} ${rg} 0` })
          else rule.append({ prop: col ? 'margin-top' : 'margin-left', value: col ? rg : cg })
          if (!groups.has(key)) groups.set(key, [])
          groups.get(key).push(rule)
        }
      })
      for (const [key, rules] of groups) {
        let node = new AtRule({ name: 'supports', params: OLD })
        node.append(rules)
        if (key) for (const m of key.split(' ## ').reverse()) { const a = new AtRule({ name: 'media', params: m }); a.append(node); node = a }
        root.append(node)
      }
    },
  }
}
flexgap.postcss = true
