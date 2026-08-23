/**
 * The parts of OAuth that decide whether a grant is legitimate.
 *
 * Everything here is pure or WebCrypto-only, and everything here is tested.
 * That is deliberate: the handlers around it do I/O and are hard to exercise,
 * while *these* are the functions that answer "is this the client it claims to
 * be", "did the person who started this flow finish it", and "may this code go
 * back to this address". Those are the questions an authorization server gets
 * wrong, so they are the ones extracted to where a test can reach them.
 *
 * Nothing in this file talks to a database, and nothing in it trusts an input.
 */
import { ALL_MODULES } from '@/modules/settings/logic'
import { DEFAULT_TOKEN_MODULES } from '@/mcp/registry'
import type { ModuleName } from '@/modules/settings/types'

/** A code is redeemed within a second or two of being issued. */
export const CODE_TTL_SECONDS = 60

/**
 * An hour, then the client refreshes.
 *
 * Long enough that a conversation is not interrupted, short enough that a
 * leaked access token is a problem with an end. The refresh token is the thing
 * that persists, and it is revocable from Settings like anything else.
 */
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60

/**
 * Scopes are module names, and that is the whole vocabulary.
 *
 * Inventing an OAuth scope language — `meridian.trips.read`, `mcp:tools` —
 * would mean a second permission model to keep in step with the one the app
 * already has. A token is scoped to modules everywhere else in this codebase;
 * a grant is scoped to modules too, and the consent screen can then show the
 * same words Settings shows.
 */
export function parseScope(scope: string | null | undefined): ModuleName[] {
  if (!scope?.trim()) return [...DEFAULT_TOKEN_MODULES]
  const asked = new Set(scope.trim().split(/\s+/))
  const known = ALL_MODULES.filter((m) => asked.has(m))
  // A client that asks for nothing recognisable gets the default rather than
  // an empty grant. An empty grant would authorise successfully and then
  // refuse every call, which reads as a broken server rather than a scope
  // mistake.
  return known.length > 0 ? known : [...DEFAULT_TOKEN_MODULES]
}

export function formatScope(modules: readonly ModuleName[]): string {
  return modules.join(' ')
}

/**
 * base64url of the SHA-256 of the verifier, compared to the stored challenge.
 *
 * S256 only. `plain` is permitted by RFC 7636 and is worth nothing against an
 * attacker who can observe the authorization request — which is the only
 * attacker PKCE exists to stop. Accepting `plain` for compatibility would mean
 * an attacker chooses which protection applies, so it is refused at the door.
 */
export async function verifyPkce(verifier: string, challenge: string): Promise<boolean> {
  if (!isValidVerifier(verifier) || !challenge) return false
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return timingSafeEqual(base64url(new Uint8Array(digest)), challenge)
}

/** RFC 7636: 43–128 characters from an unreserved set. */
export function isValidVerifier(verifier: string): boolean {
  return /^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)
}

/**
 * A redirect URI is matched exactly, character for character.
 *
 * Not a prefix match, not "same origin", not "starts with". Every published
 * OAuth redirect vulnerability is a story about a comparison looser than this
 * one — a path prefix that allowed an open redirect underneath it, or a host
 * check that `evil.com/?x=registered.com` satisfied. Exact equality has no
 * such cases, and it costs a client nothing to register the URI it will
 * actually use.
 */
export function redirectIsRegistered(registered: readonly string[], presented: string): boolean {
  return registered.some((uri) => timingSafeEqual(uri, presented))
}

/**
 * Whether a URI may be registered at all.
 *
 * Three shapes are allowed, and they are the three a real MCP client uses:
 * an https URL, a loopback URL on any port (how a desktop client catches a
 * redirect), and a private-use scheme like `claude://` (how a mobile app does).
 *
 * Plain http to anywhere other than loopback is refused: the code would cross
 * the network in the clear, and PKCE does not help with that.
 */
export function isRegisterableRedirect(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }

  // A fragment is never sent to a server and cannot be matched reliably, so a
  // URI carrying one is a mistake worth refusing at registration rather than
  // debugging at redemption.
  if (url.hash) return false

  if (url.protocol === 'https:') return true
  if (url.protocol === 'http:') {
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  }
  // A private-use scheme must be a reverse-DNS-ish name, not something that
  // resolves in a browser. `javascript:` and `data:` are the ones that matter.
  return /^[a-z][a-z0-9+.-]*:$/.test(url.protocol) &&
    !['javascript:', 'data:', 'vbscript:', 'file:', 'blob:'].includes(url.protocol)
}

/**
 * Where to send somebody when the flow fails.
 *
 * The redirect URI is only used once it has been proven registered, which is
 * why this takes an already-validated one. Handing an error back to an
 * unverified redirect is itself the open-redirect bug.
 */
export function errorRedirect(
  redirectUri: string,
  error: string,
  state: string | null,
  description?: string,
): string {
  const url = new URL(redirectUri)
  url.searchParams.set('error', error)
  if (description) url.searchParams.set('error_description', description)
  if (state) url.searchParams.set('state', state)
  return url.toString()
}

export function successRedirect(redirectUri: string, code: string, state: string | null): string {
  const url = new URL(redirectUri)
  url.searchParams.set('code', code)
  if (state) url.searchParams.set('state', state)
  return url.toString()
}

/** 32 bytes, base64url — the same strength as a personal access token. */
export function generateOpaque(bytes = 32): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return base64url(buf)
}

export function generateClientId(): string {
  return `mrdc_${generateOpaque(16)}`
}

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Constant time for equal-length strings, and a length check that is not.
 *
 * Leaking the *length* of a code tells an attacker nothing they cannot get by
 * reading the source; leaking where two codes first differ would let one be
 * recovered a character at a time.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
