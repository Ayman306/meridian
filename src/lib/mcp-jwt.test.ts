/**
 * @vitest-environment node
 *
 * Node, not jsdom. This module only ever runs on the server, and jsdom's
 * `TextEncoder` returns a Uint8Array from a different realm — which jose
 * rejects with "payload must be an instance of Uint8Array". That is an
 * artefact of the test environment rather than a bug in the code, and the
 * right fix is to test it where it actually runs.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { decodeJwt, decodeProtectedHeader } from 'jose'
import { mintUserJwt, preflight, resetPreflight } from '@/lib/mcp-jwt'

// Spaces on purpose: the secret scanner in providers.test.ts flags any
// `secret = '<24+ key-shaped chars>'` anywhere in the tree, and it is right to.
// A fixture that trips it would train someone to ignore the alarm.
const SECRET = 'fixture only, never a key'
const URL_ = 'https://project.supabase.co'
const USER = '11111111-2222-3333-4444-555555555555'

afterEach(() => {
  resetPreflight()
  vi.unstubAllGlobals()
})

describe('the claims PostgREST reads', () => {
  it('carries the user in sub, because that is what auth.uid() returns', async () => {
    const { token } = await mintUserJwt(USER, SECRET, URL_)
    expect(decodeJwt(token).sub).toBe(USER)
  })

  it('claims the authenticated role, which picks the database role', async () => {
    const { token } = await mintUserJwt(USER, SECRET, URL_)
    const claims = decodeJwt(token)
    expect(claims.role).toBe('authenticated')
    expect(claims.aud).toBe('authenticated')
  })

  it('names the project as issuer', async () => {
    const { token } = await mintUserJwt(USER, SECRET, URL_)
    expect(decodeJwt(token).iss).toBe(`${URL_}/auth/v1`)
  })

  it('signs with HS256, which is what a legacy JWT secret verifies', async () => {
    const { token } = await mintUserJwt(USER, SECRET, URL_)
    expect(decodeProtectedHeader(token).alg).toBe('HS256')
  })

  it('expires quickly, so a leaked one is worth little', async () => {
    const { token, expiresIn } = await mintUserJwt(USER, SECRET, URL_)
    const claims = decodeJwt(token)
    expect(expiresIn).toBe(600)
    expect(claims.exp! - claims.iat!).toBe(600)
  })
})

describe('proving Supabase will accept what we sign', () => {
  const stubFetch = (status: number) => {
    const spy = vi.fn().mockResolvedValue({ status } as Response)
    vi.stubGlobal('fetch', spy)
    return spy
  }

  it('accepts any answer that is not a rejection', async () => {
    // The root endpoint answers 200; a 404 would still mean the signature was
    // believed. Only 401 says it was not.
    stubFetch(200)
    await expect(preflight(USER, SECRET, URL_, 'anon')).resolves.toEqual({ ok: true })
  })

  it('reports a 401 as a signing problem, with something actionable', async () => {
    stubFetch(401)
    const result = await preflight(USER, SECRET, URL_, 'anon')
    expect(result.ok).toBe(false)
    // The message has to name the two real causes, because the symptom —
    // every query 401ing — looks identical to a revoked token.
    expect(result.ok === false && result.reason).toMatch(/asymmetric|JWT Keys/i)
  })

  it('does not latch a network blip into a permanent misdiagnosis', async () => {
    // The alternative is an exchange that stays broken after one dropped
    // packet until somebody redeploys.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')))
    await expect(preflight(USER, SECRET, URL_, 'anon')).resolves.toEqual({ ok: true })
  })

  it('spends one request, not one per exchange', async () => {
    const spy = stubFetch(200)
    await preflight(USER, SECRET, URL_, 'anon')
    await preflight(USER, SECRET, URL_, 'anon')
    await preflight(USER, SECRET, URL_, 'anon')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('re-checks once the cached answer is old', async () => {
    const spy = stubFetch(200)
    const start = Date.now()
    await preflight(USER, SECRET, URL_, 'anon', start)
    await preflight(USER, SECRET, URL_, 'anon', start + 11 * 60 * 1000)
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('never caches a failure, so fixing the secret does not need a redeploy', async () => {
    const spy = stubFetch(401)
    await preflight(USER, SECRET, URL_, 'anon')
    await preflight(USER, SECRET, URL_, 'anon')
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('sends both the apikey and the minted bearer', async () => {
    // PostgREST wants the publishable key to route the request and the JWT to
    // decide who is asking. One without the other proves nothing.
    const spy = stubFetch(200)
    await preflight(USER, SECRET, URL_, 'anon-key')
    const call = spy.mock.calls[0] as [string, RequestInit] | undefined
    const init = call![1]
    const headers = init.headers as Record<string, string>
    expect(headers.apikey).toBe('anon-key')
    expect(headers.Authorization).toMatch(/^Bearer ey/)
  })
})
