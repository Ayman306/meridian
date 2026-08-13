/** Pure functions for Module 1. Unit-tested; no Supabase, no React. */
import { INVITE_ALPHABET, INVITE_CODE_LENGTH, DEFAULT_ACCENT } from '@/lib/constants'
import type { AccentColor } from '@/lib/constants'
import type { Profile, PersonRef } from '@/types/domain'

/**
 * Client-side invite code generation, used only for previews and tests — the
 * authoritative code is minted by Postgres so uniqueness is enforced there.
 */
export function generateInviteCode(random: () => number = Math.random): string {
  let out = ''
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    out += INVITE_ALPHABET[Math.floor(random() * INVITE_ALPHABET.length)]
  }
  return out
}

/**
 * Normalise what a user typed or pasted. The alphabet excludes I, L, O, 0 and 1
 * precisely because they get confused with each other, so any of those five
 * characters is a misreading rather than a real character — drop it, along with
 * the spaces and dashes people add when reading a code aloud.
 */
export function normaliseInviteCode(input: string): string {
  return [...input.toUpperCase()]
    .filter((c) => INVITE_ALPHABET.includes(c))
    .join('')
    .slice(0, INVITE_CODE_LENGTH)
}

export function isPlausibleInviteCode(code: string): boolean {
  if (code.length !== INVITE_CODE_LENGTH) return false
  return [...code].every((c) => INVITE_ALPHABET.includes(c))
}

export function isInviteExpired(expiresAt: string | null, now: Date = new Date()): boolean {
  if (!expiresAt) return true
  return new Date(expiresAt).getTime() <= now.getTime()
}

/**
 * "Expires in 4 days" / "Expires in 3 hours" / "Expired".
 *
 * Under a day we count hours rather than saying "today" — a code that dies at
 * 08:00 tomorrow is not a today problem, and "today" would be wrong anyway.
 */
export function describeInviteExpiry(expiresAt: string | null, now: Date = new Date()): string {
  if (!expiresAt) return 'No active code'
  const ms = new Date(expiresAt).getTime() - now.getTime()
  if (ms <= 0) return 'Expired'

  const days = Math.floor(ms / 86_400_000)
  if (days > 0) return `Expires in ${days} day${days === 1 ? '' : 's'}`

  const hours = Math.floor(ms / 3_600_000)
  if (hours > 0) return `Expires in ${hours} hour${hours === 1 ? '' : 's'}`
  return 'Expires within the hour'
}

/** Setup is complete once we know where they are and what time it is there. */
export function needsProfileSetup(profile: Profile | null): boolean {
  if (!profile) return true
  if (profile.onboarded_at) return false
  return !profile.home_city || !profile.timezone || profile.timezone === 'UTC'
}

export function toPersonRef(profile: Profile | null, selfId: string | null): PersonRef | null {
  if (!profile) return null
  return {
    id: profile.id,
    displayName: profile.display_name?.trim() || 'Partner',
    avatarUrl: profile.avatar_url,
    accentColor: (profile.accent_color as AccentColor) ?? DEFAULT_ACCENT,
    isSelf: profile.id === selfId,
  }
}

/**
 * When both partners pick the same accent colour, nobody can tell whose pick is
 * whose. Nudge the second one rather than blocking the choice.
 */
export function accentCollides(self: Profile | null, partner: Profile | null): boolean {
  return Boolean(self && partner && self.accent_color === partner.accent_color)
}
