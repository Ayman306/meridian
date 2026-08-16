/**
 * Tests the caching policy by running the **real** `public/sw.js`.
 *
 * The file is evaluated in a fake ServiceWorkerGlobalScope and its predicates
 * read back off `self.__meridian`. That indirection is worth it: a test that
 * re-implemented the deny-list would pass forever while the shipped worker
 * quietly started caching Supabase responses. This one fails.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

interface Policy {
  isPrivateRequest: (request: { url: string; method: string; headers: Headers }) => boolean
  isCacheableResponse: (response: {
    ok: boolean
    type?: string
    headers: Headers
  } | null) => boolean
  isImmutableAsset: (url: URL) => boolean
  isShellAsset: (url: URL) => boolean
}

function loadWorker(): Policy {
  const source = readFileSync(join(process.cwd(), 'public/sw.js'), 'utf8')

  const listeners: Record<string, unknown> = {}
  const self: Record<string, unknown> = {
    addEventListener: (name: string, fn: unknown) => {
      listeners[name] = fn
    },
    location: { origin: 'https://meridian.example' },
    registration: {},
    clients: {},
    caches: {},
    skipWaiting: () => Promise.resolve(),
  }

  const sandbox = { self, caches: {}, fetch: () => Promise.reject(new Error('no network')), URL, Response, Headers, console }
  runInNewContext(source, sandbox)

  const policy = self.__meridian as Policy | undefined
  if (!policy) throw new Error('public/sw.js no longer exposes its policy on self.__meridian')
  return policy
}

const policy = loadWorker()

const get = (url: string, headers: Record<string, string> = {}) => ({
  url,
  method: 'GET',
  headers: new Headers(headers),
})

describe('what the service worker refuses to touch', () => {
  it('never caches anything from Supabase', () => {
    // PostgREST, GoTrue and Storage all live under the project host. A cached
    // copy answers with no RLS applied at all.
    expect(policy.isPrivateRequest(get('https://abc.supabase.co/rest/v1/trips'))).toBe(true)
    expect(policy.isPrivateRequest(get('https://abc.supabase.co/auth/v1/user'))).toBe(true)
    expect(
      policy.isPrivateRequest(get('https://abc.supabase.co/storage/v1/object/sign/media/a.jpg')),
    ).toBe(true)
  })

  it('never caches our own Route Handlers', () => {
    expect(policy.isPrivateRequest(get('https://meridian.example/api/mcp/token'))).toBe(true)
    expect(policy.isPrivateRequest(get('https://meridian.example/api/fx'))).toBe(true)
  })

  it('never caches a signed URL, wherever it is hosted', () => {
    // These expire in 300 seconds by design. Caching one keeps a credential
    // alive past the window it was scoped to.
    expect(policy.isPrivateRequest(get('https://cdn.example.com/a.jpg?token=abc'))).toBe(true)
    expect(policy.isPrivateRequest(get('https://s3.example.com/a.jpg?X-Amz-Signature=abc'))).toBe(
      true,
    )
  })

  it('never caches a request carrying credentials', () => {
    expect(
      policy.isPrivateRequest(get('https://meridian.example/x', { authorization: 'Bearer x' })),
    ).toBe(true)
  })

  it('never caches a mutation', () => {
    expect(
      policy.isPrivateRequest({
        url: 'https://meridian.example/_next/static/chunk.js',
        method: 'POST',
        headers: new Headers(),
      }),
    ).toBe(true)
  })

  it('does allow the genuinely shared bytes through', () => {
    expect(policy.isPrivateRequest(get('https://meridian.example/_next/static/chunk.js'))).toBe(
      false,
    )
    expect(policy.isPrivateRequest(get('https://meridian.example/icons/icon-192.png'))).toBe(false)
  })
})

describe('which responses may be stored', () => {
  const response = (over: Partial<{ ok: boolean; type: string; cacheControl: string }> = {}) => ({
    ok: over.ok ?? true,
    type: over.type ?? 'basic',
    headers: new Headers(over.cacheControl ? { 'cache-control': over.cacheControl } : {}),
  })

  it('stores an ordinary same-origin success', () => {
    expect(policy.isCacheableResponse(response())).toBe(true)
  })

  it('refuses an error', () => {
    expect(policy.isCacheableResponse(response({ ok: false }))).toBe(false)
    expect(policy.isCacheableResponse(null)).toBe(false)
  })

  it('refuses an opaque response', () => {
    // Status 0 and unreadable headers: storing one caches something that
    // cannot be inspected and cannot be invalidated.
    expect(policy.isCacheableResponse(response({ type: 'opaque' }))).toBe(false)
    expect(policy.isCacheableResponse(response({ type: 'opaqueredirect' }))).toBe(false)
  })

  it('honours the server saying not to', () => {
    expect(policy.isCacheableResponse(response({ cacheControl: 'no-store' }))).toBe(false)
    expect(policy.isCacheableResponse(response({ cacheControl: 'private, max-age=0' }))).toBe(false)
  })
})

describe('which URLs get which strategy', () => {
  const url = (path: string) => new URL(`https://meridian.example${path}`)

  it('treats the build output as immutable', () => {
    // Content-hashed, so a URL never changes meaning.
    expect(policy.isImmutableAsset(url('/_next/static/chunks/main-abc123.js'))).toBe(true)
    expect(policy.isImmutableAsset(url('/trips'))).toBe(false)
    // Not content-hashed — a deploy changes it under the same URL.
    expect(policy.isImmutableAsset(url('/icons/icon-192.png'))).toBe(false)
  })

  it('treats icons and the manifest as shell', () => {
    expect(policy.isShellAsset(url('/icon.svg'))).toBe(true)
    expect(policy.isShellAsset(url('/manifest.webmanifest'))).toBe(true)
    expect(policy.isShellAsset(url('/icons/maskable-512.png'))).toBe(true)
  })

  it('does not treat an HTML page as either', () => {
    // The important one. Some routes are Server Components that render a
    // person's data into the markup, and the cache is per-origin rather than
    // per-account — so a cached page could outlive a sign-out.
    for (const path of ['/', '/trips', '/trips/abc/money', '/settings']) {
      expect(`${path}:${policy.isImmutableAsset(url(path))}`).toBe(`${path}:false`)
      expect(`${path}:${policy.isShellAsset(url(path))}`).toBe(`${path}:false`)
    }
  })
})
