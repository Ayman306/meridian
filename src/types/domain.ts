/**
 * Hand-written domain types. These are what the UI speaks; `database.ts` is
 * what Postgres speaks. Modules map between the two in their own `api.ts`.
 */
import type { Tables } from '@/types/database'
import type { AccentColor } from '@/lib/constants'

export type Profile = Omit<Tables<'profiles'>, 'accent_color'> & {
  accent_color: AccentColor
}

export type Couple = Tables<'couples'>
export type CoupleMember = Tables<'couple_members'>

/** The two people, from the viewer's point of view. */
export interface CoupleContextValue {
  couple: Couple | null
  self: Profile | null
  partner: Profile | null
  /** Signed in but not yet paired. A real, potentially long-lived state. */
  isSolo: boolean
  /** Paired, but the partner's account no longer exists. */
  isOrphaned: boolean
  isLoading: boolean
  error: unknown
  refetch: () => Promise<void>
}

/** Which of the two proposed / owns something. Drives PersonBadge. */
export type PersonRef = {
  id: string
  displayName: string
  avatarUrl: string | null
  accentColor: AccentColor
  isSelf: boolean
}

export type Severity = 'ok' | 'info' | 'warning' | 'blocking'
