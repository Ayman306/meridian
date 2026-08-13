/**
 * Supabase clients for server contexts: Server Components, Route Handlers and
 * middleware. Each reads the session from cookies rather than localStorage.
 */
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/types/database'

function readEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.')
  }
  return { url, anonKey }
}

/**
 * A client bound to the caller's session, for Server Components and Route
 * Handlers. Runs as the signed-in user, so every query is still governed by
 * RLS — the server bypasses nothing.
 */
export async function createServerSupabase() {
  const { url, anonKey } = readEnv()
  const cookieStore = await cookies()

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) {
            cookieStore.set(name, value, options)
          }
        } catch {
          // Server Components cannot set cookies. Middleware refreshes the
          // session on every request, so this is safe to ignore here.
        }
      },
    },
  })
}

/**
 * The service-role client. Bypasses RLS entirely, so it may only be used in a
 * Route Handler that has already established who the caller is and what they
 * are allowed to touch. Never import this into a component.
 */
export function createAdminSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY — this must never be a NEXT_PUBLIC_ var.')
  }
  return createServerClient<Database>(url, serviceKey, {
    cookies: { getAll: () => [], setAll: () => {} },
  })
}

/** The caller's user, or null. The one question every Route Handler asks first. */
export async function requireUser() {
  const supabase = await createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
}
