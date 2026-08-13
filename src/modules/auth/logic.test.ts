import { describe, expect, it } from 'vitest'
import {
  accentCollides,
  describeInviteExpiry,
  generateInviteCode,
  isInviteExpired,
  isPlausibleInviteCode,
  needsProfileSetup,
  normaliseInviteCode,
  toPersonRef,
} from '@/modules/auth/logic'
import { INVITE_ALPHABET } from '@/lib/constants'
import type { Profile } from '@/types/domain'

const profile = (over: Partial<Profile> = {}): Profile => ({
  id: 'u1',
  display_name: 'Sam',
  avatar_url: null,
  home_city: 'Toronto',
  home_country: 'Canada',
  home_lat: 43.65,
  home_lng: -79.38,
  timezone: 'America/Toronto',
  nationality: 'CA',
  second_nationality: null,
  accent_color: 'amber',
  onboarded_at: '2026-01-01T00:00:00Z',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...over,
})

describe('invite codes', () => {
  it('only uses unambiguous characters', () => {
    const code = generateInviteCode()
    expect(code).toHaveLength(8)
    for (const c of code) expect(INVITE_ALPHABET).toContain(c)
    expect(code).not.toMatch(/[ILO01]/)
  })

  it('strips the characters we never mint', () => {
    // A user reading "ABCD2345" aloud may hear an O or a 1 that was never there.
    expect(normaliseInviteCode('abcd-2345')).toBe('ABCD2345')
    expect(normaliseInviteCode('ABCO12345')).toBe('ABC2345')
    expect(normaliseInviteCode('  a b c d 2 3 4 5  ')).toBe('ABCD2345')
  })

  it('never returns more than the code length', () => {
    expect(normaliseInviteCode('ABCD2345EXTRA')).toHaveLength(8)
  })

  it('validates plausibility before hitting the network', () => {
    expect(isPlausibleInviteCode('ABCD2345')).toBe(true)
    expect(isPlausibleInviteCode('ABCD234')).toBe(false)
    expect(isPlausibleInviteCode('ABCD2340')).toBe(false)
  })

  it('treats a null expiry as expired', () => {
    expect(isInviteExpired(null)).toBe(true)
  })

  it('describes the remaining window', () => {
    const now = new Date('2026-06-01T12:00:00Z')
    expect(describeInviteExpiry('2026-06-05T12:00:00Z', now)).toBe('Expires in 4 days')
    expect(describeInviteExpiry('2026-06-02T12:00:00Z', now)).toBe('Expires in 1 day')
    // Under a day we count hours, never "today" — the code may well die tomorrow.
    expect(describeInviteExpiry('2026-06-02T11:00:00Z', now)).toBe('Expires in 23 hours')
    expect(describeInviteExpiry('2026-06-01T13:00:00Z', now)).toBe('Expires in 1 hour')
    expect(describeInviteExpiry('2026-06-01T12:30:00Z', now)).toBe('Expires within the hour')
    expect(describeInviteExpiry('2026-05-30T12:00:00Z', now)).toBe('Expired')
    expect(describeInviteExpiry(null, now)).toBe('No active code')
  })
})

describe('profile setup gate', () => {
  it('requires setup when there is no profile', () => {
    expect(needsProfileSetup(null)).toBe(true)
  })

  it('requires setup when we do not know where they are', () => {
    expect(needsProfileSetup(profile({ home_city: null, onboarded_at: null }))).toBe(true)
    expect(needsProfileSetup(profile({ timezone: 'UTC', onboarded_at: null }))).toBe(true)
  })

  it('does not re-prompt someone who has finished setup', () => {
    // Someone who genuinely lives on UTC and completed setup is left alone.
    expect(needsProfileSetup(profile({ timezone: 'UTC' }))).toBe(false)
    expect(needsProfileSetup(profile())).toBe(false)
  })
})

describe('person refs', () => {
  it('marks the viewer as self', () => {
    expect(toPersonRef(profile(), 'u1')?.isSelf).toBe(true)
    expect(toPersonRef(profile({ id: 'u2' }), 'u1')?.isSelf).toBe(false)
  })

  it('falls back to a usable name', () => {
    expect(toPersonRef(profile({ display_name: '   ' }), 'u1')?.displayName).toBe('Partner')
  })

  it('returns null for a missing profile', () => {
    expect(toPersonRef(null, 'u1')).toBeNull()
  })

  it('detects an accent colour collision', () => {
    expect(accentCollides(profile(), profile({ id: 'u2' }))).toBe(true)
    expect(accentCollides(profile(), profile({ id: 'u2', accent_color: 'teal' }))).toBe(false)
    expect(accentCollides(profile(), null)).toBe(false)
  })
})
