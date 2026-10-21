import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import legacy from '@vitejs/plugin-legacy'
import flexgap from './tools/flexgap.js'

// base './' + Hash-Routing: läuft auf GitHub Pages, Vercel, Netlify ohne Extra-Konfiguration.
// Legacy-Build: zusätzlich eine Fassung für ältere Browser (z. B. Fernseher mit altem Chromium/WebKit).
export default defineConfig({
  base: './',
  plugins: [react(), legacy({ targets: ['chrome >= 47', 'safari >= 10', 'firefox >= 52', 'edge >= 15', 'ios >= 10'] })],
  css: { postcss: { plugins: [flexgap()] } },
  build: { cssTarget: 'chrome61' },
})
