/**
 * POST /api/oauth/token — where a code, or a refresh token, becomes a grant.
 *
 * This is the most security-critical handler in the app, so the order of
 * checks below is the point of the file and is worth reading as one sequence.
 * Nothing is issued until every one of them has passed.
 *
 * ## The authorization_code path, in order
 *
 *   1. The code is looked up **by hash**, never by value.
 *   2. Expiry. A minute, from `CODE_TTL_SECONDS`.
 *   3. The client presenting it is the client it was issued to.
 *   4. The redirect URI presented matches the one bound at issue.
 *   5. PKCE: SHA-256 of the verifier equals the stored challenge. S256 only.
 *   6. Consumption is an atomic compare-and-set, so two simultaneous
 *      redemptions cannot both succeed.
 *
 * Only then is a token written.
 *
 * ## Replay is answered, not merely refused
 *
 * A code presented twice is either a broken client or an attacker holding a
 * stolen code, and the two are indistinguishable from here. So the second
 * presentation revokes the token the first one produced. Refusing the replay
 * alone would leave the attacker's grant — if they were the *first* caller —
 * quietly working.
 *
 * The same reasoning covers refresh tokens: presenting the superseded one is
 * reuse, and it revokes the grant rather than just failing.
 *
 * ## Why the issued token is an ordinary access token
 *
 * It is a row in `access_tokens`, `mrd_`-shaped, hashed at rest, scoped to
 * modules, exchanged for the same ten-minute user JWT. `/api/mcp/rpc` needed
 * no change to accept one, Settings needed no second list, and revoking is the
 * button that already exists. A grant is a token approved through a different
 * door — not a second kind of credential with its own rules to get wrong.
 */
import { NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase/server'
import { generateToken, hashToken, tokenPrefix } from '@/lib/tokens'
import { ACCESS_TOKEN_TTL_SECONDS, formatScope, verifyPkce } from '@/lib/oauth'
import type { ModuleName } from '@/modules/settings/types'

export const dynamic = 'force-dynamic'

/** RFC 6749 error responses are a fixed vocabulary; clients switch on them. */
function fail(error: string, description: string, status = 400) {
  return NextResponse.json(
    { error, error_description: description },
    // No-store is required by the spec on this endpoint, and is not a
    // formality: a cached token response is a token in a proxy.
    { status, headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } },
  )
}

function issued(accessToken: string, refreshToken: string, modules: ModuleName[]) {
  return NextResponse.json(
    {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: refreshToken,
      scope: formatScope(modules),
    },
    { headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } },
  )
}

/**
 * The spec says form-encoded. Real clients occasionally send JSON, and
 * refusing them over a content type would be pedantry that costs a connection.
 */
async function readParams(request: Request): Promise<Record<string, string>> {
  const contentType = request.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    const body = (await request.json()) as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(body).map(([k, v]) => [k, typeof v === 'string' ? v : String(v)]),
    )
  }
  const form = await request.formData()
  return Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]))
}

export async function POST(request: Request) {
  let params: Record<string, string>
  try {
    params = await readParams(request)
  } catch {
    return fail('invalid_request', 'Could not read the request body.')
  }

  const grantType = params.grant_type
  if (grantType === 'authorization_code') return exchangeCode(params)
  if (grantType === 'refresh_token') return refresh(params)

  return fail(
    'unsupported_grant_type',
    'This server supports authorization_code and refresh_token only.',
  )
}

async function exchangeCode(params: Record<string, string>) {
  const { code, client_id: clientId, redirect_uri: redirectUri, code_verifier: verifier } = params

  if (!code || !clientId || !redirectUri || !verifier) {
    return fail(
      'invalid_request',
      'code, client_id, redirect_uri and code_verifier are all required.',
    )
  }

  const admin = createAdminSupabase()
  const { data: row, error } = await admin
    .from('oauth_codes')
    .select('id, client_id, user_id, redirect_uri, code_challenge, modules, expires_at, consumed_at, issued_token_id')
    .eq('code_hash', await hashToken(code))
    .maybeSingle()

  if (error) {
    console.error('oauth/token: code lookup failed', error.message)
    return fail('server_error', 'Could not complete that exchange.', 500)
  }

  // One message for every way a code can be unacceptable — unknown, expired,
  // wrong client, wrong redirect. Distinguishing them would tell somebody
  // probing the endpoint which of their guesses was real.
  if (!row) return fail('invalid_grant', 'That code is not valid.')

  if (row.consumed_at) {
    // Replay. Whoever holds the token this code produced should not keep it:
    // either a client is retrying, in which case it will re-authorise, or an
    // attacker got there first and the grant must die.
    if (row.issued_token_id) {
      await admin
        .from('access_tokens')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', row.issued_token_id)
        .is('revoked_at', null)
    }
    console.warn('oauth/token: authorization code replayed; grant revoked', row.id)
    return fail('invalid_grant', 'That code is not valid.')
  }

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    return fail('invalid_grant', 'That code is not valid.')
  }
  if (row.client_id !== clientId) return fail('invalid_grant', 'That code is not valid.')
  if (row.redirect_uri !== redirectUri) return fail('invalid_grant', 'That code is not valid.')
  if (!(await verifyPkce(verifier, row.code_challenge))) {
    return fail('invalid_grant', 'That code is not valid.')
  }

  // Compare-and-set. Two simultaneous redemptions race here and exactly one
  // sees a row come back; the loser is treated as the replay it is.
  const claimed = await admin
    .from('oauth_codes')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', row.id)
    .is('consumed_at', null)
    .select('id')
    .maybeSingle()

  if (claimed.error || !claimed.data) {
    return fail('invalid_grant', 'That code is not valid.')
  }

  const modules = (row.modules ?? []) as ModuleName[]
  const accessToken = generateToken()
  const refreshToken = generateToken()

  const { data: token, error: writeError } = await admin
    .from('access_tokens')
    .insert({
      user_id: row.user_id,
      name: 'Connected app',
      token_hash: await hashToken(accessToken),
      prefix: tokenPrefix(accessToken),
      modules,
      kind: 'oauth',
      client_id: clientId,
      refresh_token_hash: await hashToken(refreshToken),
      expires_at: new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString(),
    })
    .select('id')
    .single()

  if (writeError || !token) {
    console.error('oauth/token: could not issue', writeError?.message)
    return fail('server_error', 'Could not complete that exchange.', 500)
  }

  // Recorded after the insert so a replay has something to revoke. A failure
  // here costs replay detection for this one code, not the grant itself.
  const linked = await admin
    .from('oauth_codes')
    .update({ issued_token_id: token.id })
    .eq('id', row.id)
  if (linked.error) console.warn('oauth/token: could not link code to token', linked.error.message)

  await admin
    .from('oauth_clients')
    .update({ last_used_at: new Date().toISOString() })
    .eq('client_id', clientId)

  return issued(accessToken, refreshToken, modules)
}

async function refresh(params: Record<string, string>) {
  const { refresh_token: presented, client_id: clientId } = params
  if (!presented) return fail('invalid_request', 'refresh_token is required.')

  const admin = createAdminSupabase()
  const presentedHash = await hashToken(presented)

  const { data: row, error } = await admin
    .from('access_tokens')
    .select('id, user_id, modules, client_id, expires_at, revoked_at, refresh_token_hash, previous_refresh_hash')
    .or(`refresh_token_hash.eq.${presentedHash},previous_refresh_hash.eq.${presentedHash}`)
    .maybeSingle()

  if (error) {
    console.error('oauth/token: refresh lookup failed', error.message)
    return fail('server_error', 'Could not refresh that grant.', 500)
  }
  if (!row) return fail('invalid_grant', 'That refresh token is not valid.')

  // Reuse of a token that has already been rotated away. The legitimate client
  // holds the current one, so this is either a stolen copy or a client so
  // confused it should start over. Either way the grant ends here.
  if (row.previous_refresh_hash === presentedHash) {
    await admin
      .from('access_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', row.id)
      .is('revoked_at', null)
    console.warn('oauth/token: rotated refresh token reused; grant revoked', row.id)
    return fail('invalid_grant', 'That refresh token is not valid.')
  }

  // Revocation still applies. Expiry does not: `expires_at` is the *access*
  // token's life, and refreshing an expired access token is the entire point.
  if (row.revoked_at) return fail('invalid_grant', 'That refresh token is not valid.')
  if (clientId && row.client_id !== clientId) {
    return fail('invalid_grant', 'That refresh token is not valid.')
  }

  const modules = (row.modules ?? []) as ModuleName[]
  const accessToken = generateToken()
  const refreshToken = generateToken()

  const rotated = await admin
    .from('access_tokens')
    .update({
      token_hash: await hashToken(accessToken),
      prefix: tokenPrefix(accessToken),
      refresh_token_hash: await hashToken(refreshToken),
      previous_refresh_hash: presentedHash,
      expires_at: new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString(),
      last_used_at: new Date().toISOString(),
    })
    .eq('id', row.id)
    // Only rotate from the state we read. A concurrent refresh would otherwise
    // have both callers believe they hold the current token.
    .eq('refresh_token_hash', presentedHash)
    .select('id')
    .maybeSingle()

  if (rotated.error || !rotated.data) {
    return fail('invalid_grant', 'That refresh token is not valid.')
  }

  return issued(accessToken, refreshToken, modules)
}
