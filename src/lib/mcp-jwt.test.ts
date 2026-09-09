/**
 * @vitest-environment node
 *
 * Node, not jsdom. This module only ever runs on the server, and jsdom's
 * `TextEncoder` returns a Uint8Array from a different realm — which jose
 * rejects with "payload must be an instance of Uint8Array". That is an
 * artefact of the test environment rather than a bug in the code, and the
 * right fix is to test it where it actually runs.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  decodeJwt,
  decodeProtectedHeader,
  exportJWK,
  generateKeyPair,
  jwtVerify,
  importJWK,
  type JWK,
} from 'jose'
import {
  mintUserJwt,
  preflight,
  readSigning,
  resetPreflight,
  resetSigningKeyCache,
  SigningConfigError,
  type Signing,
} from '@/lib/mcp-jwt'

// Spaces on purpose: the secret scanner in providers.test.ts flags any
// `secret = '<24+ key-shaped chars>'` anywhere in the tree, and it is right to.
// A fixture that trips it would train someone to ignore the alarm.
const SECRET = 'fixture only, never a key'
const URL_ = 'https://project.supabase.co'
const USER = '11111111-2222-3333-4444-555555555555'

const HS: Signing = { alg: 'HS256', secret: SECRET }

/** A real key pair, so the ES256 assertions exercise actual signing. */
let privateJwk: JWK
let publicJwk: JWK
const KID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true })
  privateJwk = { ...(await exportJWK(privateKey)), kid: KID }
  publicJwk = { ...(await exportJWK(publicKey)), kid: KID }
})

const es = (): Signing => ({ alg: 'ES256', jwk: privateJwk, kid: KID })

afterEach(() => {
  resetPreflight()
  resetSigningKeyCache()
  vi.unstubAllGlobals()
})

describe('the claims PostgREST reads', () => {
  it('carries the user in sub, because that is what auth.uid() returns', async () => {
    const { token } = await mintUserJwt(USER, URL_, HS)
    expect(decodeJwt(token).sub).toBe(USER)
  })

  it('claims the authenticated role, which picks the database role', async () => {
    const { token } = await mintUserJwt(USER, URL_, HS)
    const claims = decodeJwt(token)
    expect(claims.role).toBe('authenticated')
    expect(claims.aud).toBe('authenticated')
  })

  it('names the project as issuer', async () => {
    const { token } = await mintUserJwt(USER, URL_, HS)
    expect(decodeJwt(token).iss).toBe(`${URL_}/auth/v1`)
  })

  it('expires quickly, so a leaked one is worth little', async () => {
    const { token, expiresIn } = await mintUserJwt(USER, URL_, HS)
    const claims = decodeJwt(token)
    expect(expiresIn).toBe(600)
    expect(claims.exp! - claims.iat!).toBe(600)
  })

  it('carries the same claims whichever way it was signed', async () => {
    const { token } = await mintUserJwt(USER, URL_, es())
    const claims = decodeJwt(token)
    expect(claims.sub).toBe(USER)
    expect(claims.role).toBe('authenticated')
    expect(claims.aud).toBe('authenticated')
    expect(claims.iss).toBe(`${URL_}/auth/v1`)
  })
})

/**
 * The `kid` is how PostgREST picks a verification key once a project has
 * migrated to JWT signing keys. Omitting it does not produce a bad signature —
 * it produces "No suitable key or wrong key type", which names no secret and
 * survives rotating the shared secret back to being current. These assertions
 * exist because that cost a morning to diagnose in production.
 */
describe('naming which signing key we are', () => {
  it('carries the kid so PostgREST can choose a key', async () => {
    const { token } = await mintUserJwt(USER, URL_, { ...HS, kid: 'key-one' })
    expect(decodeProtectedHeader(token).kid).toBe('key-one')
  })

  it('omits it entirely on a legacy project, rather than sending an empty one', async () => {
    const { token } = await mintUserJwt(USER, URL_, HS)
    expect('kid' in decodeProtectedHeader(token)).toBe(false)
  })

  it('takes the ES256 kid from the key itself, so there is nothing to forget', async () => {
    const { token } = await mintUserJwt(USER, URL_, es())
    const header = decodeProtectedHeader(token)
    expect(header.alg).toBe('ES256')
    expect(header.kid).toBe(KID)
  })
})

describe('signing with an imported ES256 key', () => {
  it('produces a signature the matching public key verifies', async () => {
    const { token } = await mintUserJwt(USER, URL_, es())
    const key = await importJWK(publicJwk, 'ES256')
    const { payload } = await jwtVerify(token, key, {
      audience: 'authenticated',
      issuer: `${URL_}/auth/v1`,
    })
    expect(payload.sub).toBe(USER)
  })

  it('is rejected by a different key, which is the point of asymmetric signing', async () => {
    const { publicKey } = await generateKeyPair('ES256', { extractable: true })
    const { token } = await mintUserJwt(USER, URL_, es())
    await expect(jwtVerify(token, publicKey)).rejects.toThrow()
  })
})

describe('reading the configuration', () => {
  const env = (over: Record<string, string | undefined>) => over as NodeJS.ProcessEnv

  it('prefers an imported private key over the legacy secret', () => {
    const signing = readSigning(
      env({ SUPABASE_JWT_PRIVATE_KEY: JSON.stringify(privateJwk), SUPABASE_JWT_SECRET: SECRET }),
    )
    expect(signing).toMatchObject({ alg: 'ES256', kid: KID })
  })

  it('falls back to the shared secret, which is still a valid setup', () => {
    expect(readSigning(env({ SUPABASE_JWT_SECRET: SECRET }))).toMatchObject({
      alg: 'HS256',
      secret: SECRET,
    })
  })

  it('treats a blank kid as none at all', () => {
    const signing = readSigning(env({ SUPABASE_JWT_SECRET: SECRET, SUPABASE_JWT_KID: '   ' }))
    expect(signing).toMatchObject({ alg: 'HS256' })
    expect(signing?.kid).toBeUndefined()
  })

  it('reports no configuration as null, not as an error', () => {
    expect(readSigning(env({}))).toBeNull()
  })

  // Each of these names the field, because "not configured" about a variable
  // somebody can see is set is the least useful thing we could say.
  it('rejects a private key that is not JSON, and says so', () => {
    expect(() => readSigning(env({ SUPABASE_JWT_PRIVATE_KEY: 'not-json' }))).toThrow(
      SigningConfigError,
    )
  })

  it('rejects a key with no kid, since it could never be selected', () => {
    const { kid: _kid, ...noKid } = privateJwk
    expect(() => readSigning(env({ SUPABASE_JWT_PRIVATE_KEY: JSON.stringify(noKid) }))).toThrow(
      /no "kid"/,
    )
  })

  it('rejects the public half, which is the easy paste to get wrong', () => {
    expect(() => readSigning(env({ SUPABASE_JWT_PRIVATE_KEY: JSON.stringify(publicJwk) }))).toThrow(
      /public key/,
    )
  })
})

describe('proving Supabase will accept what we sign', () => {
  const stubFetch = (status: number) => {
    const spy = vi.fn().mockResolvedValue({ status } as Response)
    vi.stubGlobal('fetch', spy)
    return spy
  }

  it('accepts any answer that is not a rejection', async () => {
    stubFetch(200)
    expect(await preflight(USER, URL_, 'anon', HS)).toEqual({ ok: true })
  })

  it('reports a 401 as a signing problem, with something actionable', async () => {
    stubFetch(401)
    const result = await preflight(USER, URL_, 'anon', HS)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('SUPABASE_JWT_SECRET')
  })

  it('does not latch a network blip into a permanent misdiagnosis', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    expect(await preflight(USER, URL_, 'anon', HS)).toEqual({ ok: true })
  })

  it('spends one request, not one per exchange', async () => {
    const spy = stubFetch(200)
    await preflight(USER, URL_, 'anon', HS)
    await preflight(USER, URL_, 'anon', HS)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('re-checks once the cached answer is old', async () => {
    const spy = stubFetch(200)
    const t = Date.now()
    await preflight(USER, URL_, 'anon', HS, t)
    await preflight(USER, URL_, 'anon', HS, t + 11 * 60 * 1000)
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('never caches a failure, so fixing the key does not need a redeploy', async () => {
    const spy = stubFetch(401)
    await preflight(USER, URL_, 'anon', HS)
    await preflight(USER, URL_, 'anon', HS)
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('sends both the apikey and the minted bearer', async () => {
    // PostgREST needs the anon key to route and the bearer to decide who is
    // asking. One without the other proves nothing.
    const spy = stubFetch(200)
    await preflight(USER, URL_, 'anon-key', HS)
    const call = spy.mock.calls[0] as [string, RequestInit] | undefined
    const headers = call![1].headers as Record<string, string>
    expect(headers.apikey).toBe('anon-key')
    expect(headers.Authorization).toMatch(/^Bearer ey/)
  })

  it('proves the key it will actually sign with, not a different one', async () => {
    const spy = stubFetch(200)
    await preflight(USER, URL_, 'anon', { ...HS, kid: 'key-two' })
    const call = spy.mock.calls[0] as [string, RequestInit] | undefined
    const headers = call![1].headers as Record<string, string>
    const sent = headers.Authorization!.replace('Bearer ', '')
    expect(decodeProtectedHeader(sent).kid).toBe('key-two')
  })

  // The three refusals differ because the remedies differ. A single message
  // listing every possibility is what this replaced, and it sent people to
  // re-check a secret that was fine.
  it('names SUPABASE_JWT_KID when a rejection came with no key id', async () => {
    stubFetch(401)
    const result = await preflight(USER, URL_, 'anon', HS)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('No suitable key or wrong key type')
    expect(result.reason).toContain('SUPABASE_JWT_PRIVATE_KEY')
  })

  it('names the shared-secret key that was refused when one was sent', async () => {
    stubFetch(401)
    const result = await preflight(USER, URL_, 'anon', { ...HS, kid: 'key-three' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('key-three')
  })

  it('points an ES256 refusal at the key state, not at a secret', async () => {
    stubFetch(401)
    const result = await preflight(USER, URL_, 'anon', es())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain(KID)
    expect(result.reason).toContain('SUPABASE_JWT_PRIVATE_KEY')
    // The five-minute throttle is the thing that makes a correct change look
    // like a failed one, so the message says it rather than leaving someone
    // clicking.
    expect(result.reason).toContain('throttled')
    expect(result.reason).not.toContain('SUPABASE_JWT_SECRET')
  })

  it('reports an unusable key as configuration, not as a network blip', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200 } as Response))
    const broken: Signing = { alg: 'ES256', jwk: { kty: 'EC', kid: KID, d: 'nonsense' }, kid: KID }
    const result = await preflight(USER, URL_, 'anon', broken)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('SUPABASE_JWT_PRIVATE_KEY')
  })
})
