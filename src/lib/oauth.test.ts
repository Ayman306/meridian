/**
 * The security surface of the authorization server, exercised directly.
 *
 * These are not tests of an OAuth library — there is no library. They are the
 * cases that turn into CVEs when a hand-rolled server gets them wrong: a
 * redirect matched too loosely, a PKCE method downgraded, a verifier accepted
 * because it merely resembled one.
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  errorRedirect,
  generateClientId,
  generateOpaque,
  isRegisterableRedirect,
  isValidVerifier,
  parseScope,
  redirectIsRegistered,
  successRedirect,
  verifyPkce,
} from './oauth'
import { DEFAULT_TOKEN_MODULES } from '@/mcp/registry'

describe('PKCE', () => {
  // The worked example from RFC 7636 appendix B, so this is checked against
  // the specification rather than against our own implementation.
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
  const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'

  it('accepts the verifier that produced the challenge', async () => {
    expect(await verifyPkce(verifier, challenge)).toBe(true)
  })

  it('refuses a verifier that did not', async () => {
    expect(await verifyPkce('a'.repeat(43), challenge)).toBe(false)
  })

  it('refuses a plain-method challenge, even a correct one', async () => {
    // The whole attack: a client that can be talked into `plain` has no PKCE
    // at all, because the challenge and the verifier are the same string.
    expect(await verifyPkce(verifier, verifier)).toBe(false)
  })

  it('refuses a malformed verifier before hashing it', async () => {
    expect(await verifyPkce('short', challenge)).toBe(false)
    expect(await verifyPkce('', challenge)).toBe(false)
    expect(await verifyPkce(`${verifier}!!`, challenge)).toBe(false)
  })

  it('refuses an empty challenge', async () => {
    // A row with no challenge must never be redeemable by anything.
    expect(await verifyPkce(verifier, '')).toBe(false)
  })

  it('holds the RFC length bounds', () => {
    expect(isValidVerifier('a'.repeat(42))).toBe(false)
    expect(isValidVerifier('a'.repeat(43))).toBe(true)
    expect(isValidVerifier('a'.repeat(128))).toBe(true)
    expect(isValidVerifier('a'.repeat(129))).toBe(false)
  })
})

describe('redirect matching', () => {
  const registered = ['https://claude.ai/api/mcp/auth_callback']

  it('accepts only the exact string', () => {
    expect(redirectIsRegistered(registered, 'https://claude.ai/api/mcp/auth_callback')).toBe(true)
  })

  it('refuses every near miss that has ever been a vulnerability', () => {
    for (const attempt of [
      'https://claude.ai/api/mcp/auth_callback/../../evil',
      'https://claude.ai/api/mcp/auth_callback?next=https://evil.example',
      'https://claude.ai/api/mcp/auth_callback#x',
      'https://claude.ai.evil.example/api/mcp/auth_callback',
      'https://evil.example/?x=https://claude.ai/api/mcp/auth_callback',
      'https://claude.ai/api/mcp/auth_callbacK',
      'http://claude.ai/api/mcp/auth_callback',
      'https://claude.ai/api/mcp/auth_callback/',
    ]) {
      expect(redirectIsRegistered(registered, attempt)).toBe(false)
    }
  })

  it('refuses everything when nothing is registered', () => {
    expect(redirectIsRegistered([], 'https://claude.ai/cb')).toBe(false)
  })
})

describe('what may be registered', () => {
  it('allows the three shapes a real client uses', () => {
    expect(isRegisterableRedirect('https://claude.ai/api/mcp/auth_callback')).toBe(true)
    expect(isRegisterableRedirect('http://localhost:5173/callback')).toBe(true)
    expect(isRegisterableRedirect('http://127.0.0.1:49152/cb')).toBe(true)
    expect(isRegisterableRedirect('claude://oauth/callback')).toBe(true)
  })

  it('refuses plaintext http to anywhere but loopback', () => {
    // The code would cross the network in the clear, and PKCE does not help.
    expect(isRegisterableRedirect('http://claude.ai/cb')).toBe(false)
    expect(isRegisterableRedirect('http://192.168.1.5/cb')).toBe(false)
  })

  it('refuses schemes that execute rather than navigate', () => {
    expect(isRegisterableRedirect('javascript:alert(1)')).toBe(false)
    expect(isRegisterableRedirect('data:text/html,<script>')).toBe(false)
    expect(isRegisterableRedirect('file:///etc/passwd')).toBe(false)
  })

  it('refuses a fragment, which never reaches a server anyway', () => {
    expect(isRegisterableRedirect('https://claude.ai/cb#part')).toBe(false)
  })

  it('refuses what is not a URI at all', () => {
    expect(isRegisterableRedirect('not a uri')).toBe(false)
    expect(isRegisterableRedirect('')).toBe(false)
  })
})

describe('scope', () => {
  it('is module names, and nothing else', () => {
    expect(parseScope('trips money')).toEqual(['trips', 'money'])
  })

  it('drops what it does not recognise rather than failing', () => {
    expect(parseScope('trips admin:all money')).toEqual(['trips', 'money'])
  })

  it('falls back to the default rather than granting nothing', () => {
    // An empty grant authorises and then refuses every call, which reads as a
    // broken server rather than a scope mistake.
    expect(parseScope('')).toEqual(DEFAULT_TOKEN_MODULES)
    expect(parseScope(null)).toEqual(DEFAULT_TOKEN_MODULES)
    expect(parseScope('nonsense')).toEqual(DEFAULT_TOKEN_MODULES)
  })

  it('never puts health or documents in a default grant', () => {
    // The one property of scoping that matters most: sensitive data is never
    // included because somebody accepted a default.
    expect(parseScope(null)).not.toContain('health')
    expect(parseScope(null)).not.toContain('documents')
  })

  it('honours them when asked for explicitly', () => {
    expect(parseScope('trips health')).toEqual(['trips', 'health'])
  })
})

describe('building the redirect back', () => {
  it('keeps the state so the client can match its request', () => {
    const url = successRedirect('https://claude.ai/cb', 'the-code', 'xyz')
    expect(url).toBe('https://claude.ai/cb?code=the-code&state=xyz')
  })

  it('preserves a query string the client registered', () => {
    const url = successRedirect('https://claude.ai/cb?app=1', 'c', null)
    expect(new URL(url).searchParams.get('app')).toBe('1')
    expect(new URL(url).searchParams.get('code')).toBe('c')
  })

  it('reports a refusal to the client rather than dead-ending', () => {
    const url = errorRedirect('https://claude.ai/cb', 'access_denied', 'xyz', 'They said no.')
    const parsed = new URL(url)
    expect(parsed.searchParams.get('error')).toBe('access_denied')
    expect(parsed.searchParams.get('error_description')).toBe('They said no.')
    expect(parsed.searchParams.get('state')).toBe('xyz')
  })

  it('omits state entirely when the client sent none', () => {
    expect(successRedirect('https://claude.ai/cb', 'c', null)).not.toContain('state')
  })
})

describe('generated values', () => {
  it('mints distinct high-entropy codes', () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateOpaque()))
    expect(seen.size).toBe(200)
    expect([...seen][0]).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('marks a client id as ours', () => {
    expect(generateClientId()).toMatch(/^mrdc_[A-Za-z0-9_-]{22}$/)
  })
})
