import { describe, expect, it } from 'vitest'
import {
  TOKEN_PREFIX,
  bearerToken,
  generateToken,
  hashToken,
  isPlausibleToken,
  isTokenUsable,
  tokenPrefix,
} from '@/lib/tokens'

describe('minting a token', () => {
  it('is prefixed, and long enough to be worth nothing to a guesser', () => {
    const token = generateToken()
    expect(token.startsWith(TOKEN_PREFIX)).toBe(true)
    // 32 bytes → 43 unpadded base64url characters.
    expect(token.length).toBe(TOKEN_PREFIX.length + 43)
  })

  it('is URL and JSON safe', () => {
    // It gets pasted into a config file and sent in a header; a `+`, `/` or `=`
    // would survive neither reliably.
    for (let i = 0; i < 50; i++) {
      expect(generateToken().slice(TOKEN_PREFIX.length)).toMatch(/^[A-Za-z0-9_-]+$/)
    }
  })

  it('actually consumes the randomness it is given', () => {
    // Guards against a refactor that generates from a fixed buffer or reuses a
    // seed — the failure that produces identical tokens for every user.
    const zeros = generateToken(() => new Uint8Array(32))
    const ones = generateToken(() => new Uint8Array(32).fill(255))
    expect(zeros).not.toBe(ones)
  })

  it('does not repeat itself', () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateToken()))
    expect(seen.size).toBe(200)
  })
})

describe('hashing', () => {
  it('matches a known SHA-256 vector', () => {
    // Pinned against a value computed independently, so a change of encoding —
    // utf8 to utf16, hex to base64 — cannot pass by agreeing with itself.
    return expect(hashToken('abc')).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('is stable for the same token and different for another', async () => {
    const a = generateToken()
    const b = generateToken()
    expect(await hashToken(a)).toBe(await hashToken(a))
    expect(await hashToken(a)).not.toBe(await hashToken(b))
  })

  it('produces 64 hex characters', async () => {
    expect(await hashToken(generateToken())).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('recognising one before asking the database', () => {
  it('accepts what it mints', () => {
    expect(isPlausibleToken(generateToken())).toBe(true)
  })

  it('rejects everything else', () => {
    expect(isPlausibleToken(null)).toBe(false)
    expect(isPlausibleToken(undefined)).toBe(false)
    expect(isPlausibleToken('')).toBe(false)
    expect(isPlausibleToken('mrd_')).toBe(false)
    expect(isPlausibleToken('mrd_tooshort')).toBe(false)
    expect(isPlausibleToken(`sk_${'a'.repeat(43)}`)).toBe(false)
    // Right length, wrong alphabet — base64 rather than base64url.
    expect(isPlausibleToken(`mrd_${'a'.repeat(42)}+`)).toBe(false)
  })

  it('shows enough of a token to identify it and not enough to use it', () => {
    const token = generateToken()
    const prefix = tokenPrefix(token)
    expect(token.startsWith(prefix)).toBe(true)
    expect(prefix.length).toBeLessThan(token.length / 2)
  })
})

describe('reading the Authorization header', () => {
  it('takes the token out of a bearer header', () => {
    expect(bearerToken('Bearer mrd_abc')).toBe('mrd_abc')
    expect(bearerToken('bearer mrd_abc')).toBe('mrd_abc')
    expect(bearerToken('  Bearer   mrd_abc  ')).toBe('mrd_abc')
  })

  it('refuses anything that is not one', () => {
    expect(bearerToken(null)).toBeNull()
    expect(bearerToken('')).toBeNull()
    expect(bearerToken('mrd_abc')).toBeNull()
    expect(bearerToken('Basic abc')).toBeNull()
  })
})

describe('whether a token still works', () => {
  const now = new Date('2026-06-01T12:00:00Z')

  it('accepts a live one', () => {
    expect(isTokenUsable({ expires_at: null, revoked_at: null }, now)).toBe(true)
    expect(isTokenUsable({ expires_at: '2026-07-01T00:00:00Z', revoked_at: null }, now)).toBe(true)
  })

  it('refuses a revoked one even if it has not expired', () => {
    expect(
      isTokenUsable({ expires_at: '2027-01-01T00:00:00Z', revoked_at: '2026-05-01T00:00:00Z' }, now),
    ).toBe(false)
  })

  it('refuses an expired one', () => {
    expect(isTokenUsable({ expires_at: '2026-05-31T23:59:59Z', revoked_at: null }, now)).toBe(false)
    // Exactly at the boundary is expired, not valid — the safer direction.
    expect(isTokenUsable({ expires_at: '2026-06-01T12:00:00Z', revoked_at: null }, now)).toBe(false)
  })
})
