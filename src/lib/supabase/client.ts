/**
 * The browser Supabase client.
 *
 * Only the anon (publishable) key ever reaches this bundle. Anything holding a
 * third-party API key or the service role runs in a Route Handler instead —
 * see `src/app/api/README.md`.
 *
 * Sessions live in cookies rather than localStorage so the server can read them
 * too: middleware refreshes the session, and Server Components can answer "who
 * is this?" without a round trip to the client.
 */
'use client'

import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/database'

function readEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Copy .env.example to .env.local.',
    )
  }
  return { url, anonKey }
}

let browserClient: ReturnType<typeof createBrowserClient<Database>> | null = null

/**
 * Memoised: `createBrowserClient` is cheap, but a fresh client per call would
 * mean a fresh realtime connection per call.
 */
export function createClient() {
  if (browserClient) return browserClient
  const { url, anonKey } = readEnv()
  browserClient = createBrowserClient<Database>(url, anonKey, {
    realtime: {
      // Two users on one trip; we never need a firehose.
      params: { eventsPerSecond: 5 },
    },
  })
  return browserClient
}

/** Convenience for the many modules that just want "the client". */
export const supabase = new Proxy({} as ReturnType<typeof createClient>, {
  get(_target, prop, receiver) {
    return Reflect.get(createClient(), prop, receiver)
  },
})

export const AI_ENABLED = process.env.NEXT_PUBLIC_ENABLE_AI === 'true'
