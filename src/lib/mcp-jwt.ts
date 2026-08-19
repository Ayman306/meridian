/**
 * Minting the short-lived user JWT a personal access token is exchanged for,
 * and proving that PostgREST will actually accept it.
 *
 * ## Why the proving half exists
 *
 * A Supabase project signs user tokens one of two ways. Older projects use a
 * shared HS256 secret — the `SUPABASE_JWT_SECRET` — and anything holding it can
 * mint a token the API trusts. Newer projects use asymmetric signing keys,
 * where Supabase keeps the private half and publishes only a JWKS; nothing
 * outside Supabase can mint a token at all.
 *
 * This app is on the newer API-key format (`sb_publishable_…`), so which scheme
 * governs it is a real question rather than a theoretical one. And the failure
 * mode if we guess wrong is nasty: minting succeeds, the exchange returns 200
 * with a perfectly well-formed JWT, and every subsequent query fails with a
 * flat 401 that says nothing about why. The MCP server would look broken, the
 * token would look revoked, and the actual cause — a signing scheme mismatch —
 * is invisible from every one of those vantage points.
 *
 * So a token is minted once at startup and *used* against PostgREST before any
 * are handed out. The answer is cached, because this costs a request and the
 * scheme cannot change between two calls a second apart.
 */
import { SignJWT } from 'jose'

/** Long enough for a burst of tool calls, short enough to be unattractive. */
export const TTL_SECONDS = 600

/** How long a successful preflight is trusted before it is checked again. */
const PREFLIGHT_TTL_MS = 10 * 60 * 1000

export interface MintedToken {
  token: string
  expiresIn: number
}

/**
 * Sign a Supabase-shaped user JWT.
 *
 * The claims are exactly what GoTrue issues for a signed-in user, because
 * PostgREST reads `sub` for `auth.uid()` and `role` to pick the database role.
 * Anything missing here surfaces as RLS silently matching nothing.
 */
export async function mintUserJwt(
  userId: string,
  secret: string,
  supabaseUrl: string,
  ttlSeconds = TTL_SECONDS,
): Promise<MintedToken> {
  const token = await new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setAudience('authenticated')
    .setIssuer(`${supabaseUrl}/auth/v1`)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(new TextEncoder().encode(secret))

  return { token, expiresIn: ttlSeconds }
}

export type PreflightResult =
  | { ok: true }
  | { ok: false; reason: string }

let cached: { result: PreflightResult; at: number } | null = null

/** Forget the cached answer. Tests use this; nothing in the app does. */
export function resetPreflight(): void {
  cached = null
}

/**
 * Prove a minted token is accepted, by spending one on a harmless request.
 *
 * `/rest/v1/` — the PostgREST root — is used rather than a table, because it
 * needs no table to exist and no policy to pass. All that is being asked is
 * whether the signature was believed: a 401 means it was not, and anything else
 * means it was.
 *
 * A network failure is *not* treated as a bad scheme. The exchange should keep
 * working through a blip rather than latch into a permanent misdiagnosis.
 */
export async function preflight(
  userId: string,
  secret: string,
  supabaseUrl: string,
  anonKey: string,
  now = Date.now(),
): Promise<PreflightResult> {
  if (cached && now - cached.at < PREFLIGHT_TTL_MS && cached.result.ok) return cached.result

  let response: Response
  try {
    const { token } = await mintUserJwt(userId, secret, supabaseUrl, 60)
    response = await fetch(`${supabaseUrl}/rest/v1/`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
    })
  } catch {
    // Could not reach the project. Unknowable, so not cached and not fatal.
    return { ok: true }
  }

  const result: PreflightResult =
    response.status === 401
      ? {
          ok: false,
          reason:
            'Supabase rejected a token signed with SUPABASE_JWT_SECRET. Either the secret is wrong, or this project signs with asymmetric JWT signing keys — in which case nothing outside Supabase can mint a session and the MCP server needs a different exchange. Check Settings → API → JWT Keys.',
        }
      : { ok: true }

  cached = { result, at: now }
  return result
}
