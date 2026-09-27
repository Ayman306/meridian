/**
 * What a tool runs as.
 *
 * The whole security posture of this server is one decision: it holds a
 * short-lived JWT minted for one real user and calls PostgREST with it, exactly
 * as the browser does. RLS is therefore still the boundary, unchanged and
 * untrusting — an agent asking for another couple's trips gets the same empty
 * result a stranger's browser would.
 *
 * The service-role key is not reachable from here and must never become so. It
 * bypasses RLS, which would turn every prompt-injected instruction in a pasted
 * itinerary into a database-wide read. It appears once in the whole MCP path,
 * inside `/api/mcp/token`, to answer "which user is this token" — and that
 * handler returns a user JWT, never data.
 *
 * `coupleId` is resolved once, here, from the session. No tool takes a couple
 * id as an argument. RLS would refuse a forged one anyway, but a parameter that
 * can only ever hold one correct value is a parameter a model can get wrong, so
 * it is not offered.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { ModuleName } from '@/modules/settings/types'

export interface McpContext {
  supabase: SupabaseClient<Database>
  userId: string
  /**
   * Null in solo mode — signed in, not yet paired. A first-class state, not an
   * error: tools that need a couple say so plainly rather than throwing.
   */
  coupleId: string | null
  /** What the token was scoped to. Narrows which tools exist at all. */
  modules: ModuleName[]
}

/**
 * A client bound to one minted user JWT.
 *
 * `persistSession` and `autoRefreshToken` are off because this client is
 * disposable: the token exchange owns the refresh cycle and a new client is
 * built when the JWT rolls over. A background refresh timer inside a stdio
 * process that may sit idle for hours is a leak, not a feature.
 */
export function createUserClient(baseUrl: string, anonKey: string, jwt: string) {
  return createClient<Database>(baseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  })
}

/**
 * Find the couple behind the session.
 *
 * This used to be `couples … limit(1)`, on the reasoning that RLS narrows
 * `couples` to the caller's own row. It does not: somebody who is a friend on
 * another couple's trip can read that couple too, and an unordered read could
 * hand it back — after which every tool call, adding itinerary items and
 * logging expenses included, would act on the wrong couple. `my_couple_id()`
 * prefers the membership where the caller is an owner or partner (0037), and
 * the app's own `getCouple` asks the same question, so the assistant and the
 * screens always agree on whose space this is.
 */
export async function resolveCoupleId(
  supabase: SupabaseClient<Database>,
): Promise<string | null> {
  const { data, error } = await supabase.rpc('my_couple_id')
  if (error) throw new Error(`Could not read the couple: ${error.message}`)
  return data ?? null
}
