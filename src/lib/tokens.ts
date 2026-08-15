/**
 * Personal access tokens: minting, hashing, and the shape of a valid one.
 *
 * WebCrypto throughout, so the identical code runs in the browser that creates
 * a token and in the Route Handler that verifies one. That symmetry is worth
 * more than it looks: there is exactly one definition of "the hash of this
 * token", and no chance of the two sides disagreeing about encoding.
 *
 * The token is generated **in the browser**. Only its hash and prefix are ever
 * sent to Postgres, so the raw value never crosses the network, never reaches a
 * server log, and cannot be recovered from a database dump. It is shown to the
 * person once and then it is gone — which is a real constraint on the UI, not a
 * detail: there is no "show token again", because there is nothing to show.
 */

/** Distinguishes ours from every other `sk_`/`ghp_` in a config file. */
export const TOKEN_PREFIX = 'mrd_'

/**
 * 32 bytes. The same order of magnitude as a session token, and far past the
 * point where guessing is the weak link — which matters because the exchange
 * endpoint is public and a short token would make it an oracle.
 */
const TOKEN_BYTES = 32

/** Enough to tell two tokens apart in a list, nowhere near enough to use one. */
const PREFIX_CHARS = 8

/**
 * A new token, in the only form anyone will ever see it.
 *
 * base64url rather than hex: same entropy, a third shorter, and it survives
 * being pasted into a JSON config without escaping.
 */
export function generateToken(random: (n: number) => Uint8Array = randomBytes): string {
  const bytes = random(TOKEN_BYTES)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  const base64url = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${TOKEN_PREFIX}${base64url}`
}

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n)
  crypto.getRandomValues(out)
  return out
}

/**
 * SHA-256, hex. What Postgres stores and what the exchange endpoint looks up.
 *
 * A plain hash with no salt and no work factor, which would be wrong for a
 * password and is right here: the input is 256 bits of uniform randomness, so
 * there is no dictionary to try and nothing for a work factor to slow down.
 * Salting would only break the ability to look the token up by its hash, which
 * is the entire mechanism.
 */
export async function hashToken(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** `mrd_3f8aB2xQ` — the identifying stub stored alongside the hash. */
export function tokenPrefix(raw: string): string {
  return raw.slice(0, TOKEN_PREFIX.length + PREFIX_CHARS)
}

/**
 * Whether a presented string is even shaped like one of ours.
 *
 * Checked before the database is asked, so a malformed header costs a string
 * comparison rather than a query.
 */
export function isPlausibleToken(raw: string | null | undefined): boolean {
  if (!raw || !raw.startsWith(TOKEN_PREFIX)) return false
  const body = raw.slice(TOKEN_PREFIX.length)
  // 32 bytes in unpadded base64url is 43 characters.
  return body.length === 43 && /^[A-Za-z0-9_-]+$/.test(body)
}

/** Pulls the token out of `Authorization: Bearer mrd_…`. */
export function bearerToken(header: string | null): string | null {
  if (!header) return null
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim())
  return match?.[1] ?? null
}

/** Whether a token row is still usable, given its expiry and revocation. */
export function isTokenUsable(
  row: { expires_at: string | null; revoked_at: string | null },
  now: Date = new Date(),
): boolean {
  if (row.revoked_at) return false
  if (row.expires_at && new Date(row.expires_at).getTime() <= now.getTime()) return false
  return true
}
