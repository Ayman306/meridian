/**
 * Exchange a personal access token for a short-lived user JWT.
 *
 * This is the hinge of the whole MCP design, so it is worth being precise about
 * what it does and does not do.
 *
 * It does **not** return data. It answers one question — which user is this
 * token, and which modules did its owner allow — and hands back a ten-minute
 * JWT carrying that user's `sub` and the ordinary `authenticated` role. Every
 * read the MCP server then makes is a normal PostgREST request judged by the
 * normal policies. A token cannot see another couple's trips because
 * `is_couple_member` refuses, not because this file remembered to filter.
 *
 * The service role appears here and nowhere else in the MCP path. Verifying a
 * presented credential is precisely the sanctioned use described in
 * `createAdminSupabase` — establishing who is calling, before anything is
 * touched. It never leaves this handler, and no query made with it returns
 * couple data: it reads one row of `access_tokens` and writes one timestamp.
 *
 * Ten minutes is short on purpose. The MCP server re-exchanges as needed, so
 * the blast radius of a leaked JWT is a few minutes, while the thing that
 * actually persists on disk — the PAT — is revocable from Settings and dies
 * instantly when revoked.
 */
import { NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase/server'
import { bearerToken, hashToken, isPlausibleToken, isTokenUsable } from '@/lib/tokens'
import { TTL_SECONDS, mintUserJwt, preflight } from '@/lib/mcp-jwt'

export const dynamic = 'force-dynamic'

/**
 * One shape of failure for every way a token can be unacceptable — malformed,
 * unknown, expired, revoked. Distinguishing them would tell someone probing
 * the endpoint which of their guesses was a real token, which is the one thing
 * the answer must never reveal.
 */
function refuse() {
  return NextResponse.json({ error: 'That token is not valid.' }, { status: 401 })
}

export async function POST(request: Request) {
  const raw = bearerToken(request.headers.get('authorization'))
  if (!isPlausibleToken(raw)) return refuse()

  const secret = process.env.SUPABASE_JWT_SECRET
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!secret || !supabaseUrl) {
    // A configuration fault, not a caller fault — say so, because a 401 here
    // would send someone hunting for a bad token that is perfectly fine.
    console.error('SUPABASE_JWT_SECRET or NEXT_PUBLIC_SUPABASE_URL is not set.')
    return NextResponse.json({ error: 'Token exchange is not configured.' }, { status: 503 })
  }

  const admin = createAdminSupabase()
  const { data: row, error } = await admin
    .from('access_tokens')
    .select('id, user_id, modules, expires_at, revoked_at')
    .eq('token_hash', await hashToken(raw!))
    .maybeSingle()

  if (error) {
    console.error('access token lookup failed', error.message)
    return NextResponse.json({ error: 'Could not verify that token.' }, { status: 500 })
  }
  if (!row || !isTokenUsable(row)) return refuse()

  // Best-effort: a failed timestamp write must not deny a valid token, but a
  // token that never records a use makes a stolen one invisible, so it is
  // logged rather than swallowed.
  const touched = await admin
    .from('access_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', row.id)
  if (touched.error) console.warn('could not record token use', touched.error.message)

  // Prove the signature will be believed before handing one out. Without this
  // a wrong secret — or a project on asymmetric signing keys, where nothing
  // outside Supabase can mint a session — returns a valid-looking token whose
  // every subsequent query 401s, and the cause is invisible from the client.
  // Cached, so this costs one request every ten minutes at worst.
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (anonKey) {
    const check = await preflight(row.user_id, secret, supabaseUrl, anonKey)
    if (!check.ok) {
      console.error('MCP token exchange preflight failed:', check.reason)
      return NextResponse.json({ error: check.reason }, { status: 503 })
    }
  }

  const { token: accessToken } = await mintUserJwt(row.user_id, secret, supabaseUrl)

  return NextResponse.json({
    access_token: accessToken,
    expires_in: TTL_SECONDS,
    user_id: row.user_id,
    modules: row.modules,
    // Both are publishable — they are already in every browser bundle this app
    // has ever served, and the anon key grants nothing on its own because RLS
    // answers to the JWT above it. Returning them here means an MCP client
    // needs two settings (this URL and its token) instead of four, and cannot
    // end up pointed at the right database with the wrong project's key.
    supabase_url: supabaseUrl,
    supabase_anon_key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  })
}
