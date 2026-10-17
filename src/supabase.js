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
