/**
 * Minting the short-lived user JWT a personal access token is exchanged for,
 * and proving that PostgREST will actually accept it.
 *
 * ## Two ways to sign, and why the asymmetric one is preferred
 *
 * Supabase signs user tokens under one of two systems. The legacy system has a
 * single shared HS256 secret — `SUPABASE_JWT_SECRET` — and anything holding it
 * can mint a token the API trusts. The signing keys system has a *set* of keys,
 * and PostgREST chooses which one to verify with by reading the `kid` header of
 * the token it was handed.
 *
 * Once a project moves to the signing keys system, Supabase will not hand back
 * the private key or shared secret of any key it generated. Its own answer to
 * "how do I mint my own JWTs then" is to stop asking for theirs: generate a key
 * yourself, import the private half, and sign with it. That is what
 * `SUPABASE_JWT_PRIVATE_KEY` is — an ES256 private key in JWK form, produced by
 * `supabase gen signing-key --algorithm ES256`, imported to the project as a
 * signing key and rotated to.
 *
 * It is preferred over the shared secret for three reasons, in order of how
 * much they matter here:
 *
 *   1. Supabase documents the shared secret as **not recommended for
 *      production**, because anything holding it can impersonate any user and
 *      there is no way to tell that it has leaked.
 *   2. The legacy secret is a Supabase-specific artefact. An ES256 key is not:
 *      it is an ordinary JWK, and it keeps working unchanged against a
 *      self-hosted Postgres, which is where this project is going.
 *   3. Revocation of an asymmetric key is a platform action. Revoking a shared
 *      secret means redeploying everything that holds it.
 *
 * HS256 is kept, because a project still on the legacy secret is a legitimate
 * configuration and because it is the only thing that works before the
 * migration. It is the fallback, not the default.
 *
 * ## The `kid`, and the failure it causes when it is missing
 *
 * Under the signing keys system a token with no `kid` is not a token with a bad
 * signature — it is a token PostgREST cannot choose a key for at all, and it
 * says so with `No suitable key or wrong key type`, which mentions no secret
 * and no key. That message is indistinguishable from a wrong secret, and it
 * survives rotating a secret back to being the current key, because the key set
 * is still a set. An ES256 key carries its own `kid` inside the JWK, so this
 * whole class of mistake stops being possible once the key is imported: there
 * is no second variable to forget.
 *
 * ## Why the proving half exists
 *
 * If we guess the scheme wrong, minting still succeeds. The exchange returns
 * 200 with a well-formed JWT and every subsequent query fails with a flat 401
 * that says nothing about why — the server looks broken, the token looks
 * revoked, and the actual cause is invisible from all of those vantage points.
 * So a token is minted and *used* against PostgREST before any are handed out,
 * and the answer is cached, because it costs a request and the scheme cannot
 * change between two calls a second apart.
 */
import { SignJWT, importJWK, type JWK, type CryptoKey } from 'jose'

/** Long enough for a burst of tool calls, short enough to be unattractive. */
export const TTL_SECONDS = 600

/** How long a successful preflight is trusted before it is checked again. */
const PREFLIGHT_TTL_MS = 10 * 60 * 1000

export interface MintedToken {
  token: string
  expiresIn: number
}

/**
 * How this deployment signs. Resolved from the environment once, then passed
 * explicitly, so that no function further down has to reach for a global to
 * find out what it is doing — and so tests can hand over either shape without
 * touching `process.env`.
 */
export type Signing =
  | { alg: 'ES256'; jwk: JWK; kid: string }
  | { alg: 'HS256'; secret: string; kid?: string }

/** Named so a failure can say which variable was wrong, not just that one was. */
export class SigningConfigError extends Error {}

/**
 * Read the signing configuration, or null when the deployment has none.
 *
 * Null and a throw mean different things and callers treat them differently: no
 * configuration at all is "this deployment does not do MCP", which is a 503
 * saying so. Configuration that is present but unusable is a mistake somebody
 * made five minutes ago, and it names the field.
 */
export function readSigning(env: NodeJS.ProcessEnv = process.env): Signing | null {
  const raw = env.SUPABASE_JWT_PRIVATE_KEY?.trim()
  if (raw) {
    let jwk: JWK
    try {
      jwk = JSON.parse(raw) as JWK
    } catch {
      throw new SigningConfigError(
        'SUPABASE_JWT_PRIVATE_KEY is not valid JSON. It must be the whole JWK object, including the private component "d", exactly as `supabase gen signing-key --algorithm ES256` printed it.',
      )
    }
    if (!jwk.kid) {
      throw new SigningConfigError(
        'SUPABASE_JWT_PRIVATE_KEY has no "kid". Import the key to Supabase and sign with it under the same id — a token whose key cannot be identified is refused before its signature is considered.',
      )
    }
    if (!jwk.d) {
      throw new SigningConfigError(
        'SUPABASE_JWT_PRIVATE_KEY has no "d", so it is a public key. Signing needs the private half — the JWK as generated, not the one published at /auth/v1/.well-known/jwks.json.',
      )
    }
    return { alg: 'ES256', jwk, kid: jwk.kid }
  }

  const secret = env.SUPABASE_JWT_SECRET?.trim()
  if (!secret) return null
  // Blank is treated as absent rather than as a key id: `kid: ""` claims to be
  // a key nobody has, which fails less legibly than sending none.
  return { alg: 'HS256', secret, kid: env.SUPABASE_JWT_KID?.trim() || undefined }
}

/**
 * Imported keys are cached by `kid`. `importJWK` does real cryptographic work,
 * and this runs on the hot path of every tool call.
 */
const imported = new Map<string, Promise<CryptoKey | Uint8Array>>()

/** Drop cached imported keys. Tests use this; nothing in the app does. */
export function resetSigningKeyCache(): void {
  imported.clear()
}

async function keyFor(signing: Signing): Promise<CryptoKey | Uint8Array> {
  if (signing.alg === 'HS256') return new TextEncoder().encode(signing.secret)

  const hit = imported.get(signing.kid)
  if (hit) return hit
  const task = importJWK(signing.jwk, 'ES256').catch((e: unknown) => {
    imported.delete(signing.kid)
    const message = e instanceof Error ? e.message : String(e)
    throw new SigningConfigError(`SUPABASE_JWT_PRIVATE_KEY could not be imported as an ES256 key: ${message}`)
  })
  imported.set(signing.kid, task)
  return task
}

/**
 * Sign a Supabase-shaped user JWT.
 *
 * The claims are exactly what GoTrue issues for a signed-in user, because
 * PostgREST reads `sub` for `auth.uid()` and `role` to pick the database role.
 * Anything missing here surfaces as RLS silently matching nothing.
 *
 * Nothing in these claims is Supabase-specific — they are the ordinary RFC 7519
 * set — which is why this function is expected to survive the move to a
 * self-hosted Postgres unchanged.
 */
export async function mintUserJwt(
  userId: string,
  supabaseUrl: string,
  signing: Signing,
  ttlSeconds = TTL_SECONDS,
): Promise<MintedToken> {
  const header = signing.kid
    ? { alg: signing.alg, kid: signing.kid }
    : { alg: signing.alg }

  const token = await new SignJWT({ role: 'authenticated' })
    .setProtectedHeader(header)
    .setSubject(userId)
    .setAudience('authenticated')
    .setIssuer(`${supabaseUrl}/auth/v1`)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(await keyFor(signing))

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
 * What to tell someone whose token was refused, given how we signed it.
 *
 * Each branch names the variable to look at and the state that would explain
 * it. The alternative — one message listing every possibility — is what this
 * replaced, and it sent people to re-check a secret that was fine.
 */
function refusalReason(signing: Signing): string {
  if (signing.alg === 'ES256') {
    return `Supabase refused a token signed with the ES256 key "${signing.kid}" from SUPABASE_JWT_PRIVATE_KEY. The key is well-formed, so the likely causes are that it was never imported to this project, or that it is not in an accepted state — a standby or revoked key signs nothing, and only "in use" and "previously used" are accepted. Confirm it is listed at Settings → API → JWT Keys and has been rotated to. Note that key state changes are throttled for about five minutes.`
  }
  if (signing.kid) {
    return `Supabase refused a token signed with SUPABASE_JWT_SECRET as key "${signing.kid}". Either SUPABASE_JWT_KID names a key that is not currently accepted — a standby or revoked key signs nothing — or the secret does not belong to that key. Check Settings → API → JWT Keys.`
  }
  return 'Supabase refused a token signed with SUPABASE_JWT_SECRET, and it carried no key id. If this project has migrated to JWT signing keys, PostgREST chooses a verification key by the token\'s `kid` and fails with "No suitable key or wrong key type" when there is none. Prefer importing your own ES256 key and setting SUPABASE_JWT_PRIVATE_KEY, which carries its own id; failing that, set SUPABASE_JWT_KID to the in-use key. If the project never migrated, the secret is simply wrong.'
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
  supabaseUrl: string,
  anonKey: string,
  signing: Signing,
  now = Date.now(),
): Promise<PreflightResult> {
  if (cached && now - cached.at < PREFLIGHT_TTL_MS && cached.result.ok) return cached.result

  let response: Response
  try {
    const { token } = await mintUserJwt(userId, supabaseUrl, signing, 60)
    response = await fetch(`${supabaseUrl}/rest/v1/`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
    })
  } catch (e) {
    // A key we cannot even sign with is a configuration fault and is reported
    // as one. Anything else here is the network, which is unknowable rather
    // than wrong — not cached, not fatal.
    if (e instanceof SigningConfigError) return { ok: false, reason: e.message }
    return { ok: true }
  }

  const result: PreflightResult =
    response.status === 401 ? { ok: false, reason: refusalReason(signing) } : { ok: true }

  cached = { result, at: now }
  return result
}
