/**
 * Minting the short-lived user JWT a personal access token is exchanged for,
 * and proving that PostgREST will actually accept it.
 *
 * ## Why the proving half exists
 *
 * A Supabase project signs user tokens one of two ways. Under the legacy
 * system there is one shared HS256 secret — the `SUPABASE_JWT_SECRET` — and
 * anything holding it can mint a token the API trusts. Under the newer signing
 * keys system there is a *set* of keys, and PostgREST picks which one to verify
 * with by reading the `kid` header of the token it was handed.
 *
 * ## The `kid`, and the failure it causes when it is missing
 *
 * That second sentence is the whole of this file's history. A token signed with
 * the right secret but carrying no `kid` is not a token with a bad signature —
 * it is a token PostgREST cannot choose a key for at all, and it says so with
 * `No suitable key or wrong key type` rather than anything about signatures.
 *
 * The trap is that this looks identical to a project that has moved to
 * asymmetric keys, which is a wall rather than a bug: there, Supabase holds the
 * private half and nothing outside can mint. Rotating a shared secret back to
 * being the current key does *not* fix a missing `kid`, because the key set is
 * still a set. So `SUPABASE_JWT_KID` names which key we are signing as, and is
 * required on any project that has migrated — the secret alone is no longer
 * enough to be believed.
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
 * Which key we are claiming to be, or nothing on a project still on the legacy
 * secret — where there is one key, no set to choose from, and a `kid` naming a
 * key that does not exist is worse than no `kid` at all.
 */
export function signingKeyId(): string | undefined {
  return process.env.SUPABASE_JWT_KID?.trim() || undefined
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
  kid = signingKeyId(),
): Promise<MintedToken> {
  // `kid` is omitted rather than sent empty when there is none: an absent
  // header is the legacy single-key case, while `kid: ""` is a claim to be a
  // key nobody has.
  const header = kid ? { alg: 'HS256' as const, kid } : { alg: 'HS256' as const }
  const token = await new SignJWT({ role: 'authenticated' })
    .setProtectedHeader(header)
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
  kid = signingKeyId(),
): Promise<PreflightResult> {
  if (cached && now - cached.at < PREFLIGHT_TTL_MS && cached.result.ok) return cached.result

  let response: Response
  try {
    const { token } = await mintUserJwt(userId, secret, supabaseUrl, 60, kid)
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
          // Three causes, ordered by how often they are the one. The `kid` is
          // first because it is the only one that survives "I rotated the
          // secret back and it still does not work", and the only one whose
          // symptom — No suitable key or wrong key type — names no secret.
          reason: kid
            ? `Supabase rejected a token signed with SUPABASE_JWT_SECRET as key "${kid}". Either SUPABASE_JWT_KID names a key that is not currently accepted — a standby or revoked key signs nothing — or the secret does not match that key. Check Settings → API → JWT Keys.`
            : 'Supabase rejected a token signed with SUPABASE_JWT_SECRET, and it was sent without a key id. If this project has migrated to JWT signing keys, PostgREST chooses a verification key by the token\'s `kid` and fails with "No suitable key or wrong key type" when there is none — set SUPABASE_JWT_KID to the id of the in-use key. If it has not migrated, the secret is simply wrong. If the project signs with asymmetric keys and you hold no shared secret of your own, nothing outside Supabase can mint a session and the exchange needs redesigning. Check Settings → API → JWT Keys.',
        }
      : { ok: true }

  cached = { result, at: now }
  return result
}
