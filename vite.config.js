import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' + Hash-Routing: läuft auf GitHub Pages, Vercel, Netlify ohne Extra-Konfiguration
export default defineConfig({ base: './', plugins: [react()] })
