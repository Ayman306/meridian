/**
 * The single Supabase client for the browser. Only the anon (publishable) key
 * ever reaches this bundle — every privileged or third-party-keyed call goes
 * through an Edge Function (spec 0.9).
 */
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.local.',
  )
}

export const supabase = createClient<Database>(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'meridian.auth',
  },
  realtime: {
    // Two users on one trip; we never need a firehose.
    params: { eventsPerSecond: 5 },
  },
})

export const AI_ENABLED = import.meta.env.VITE_ENABLE_AI === 'true'
