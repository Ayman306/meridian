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

/**
 * The contract between whatever generates a plan and the tray that shows it.
 *
 * It lives here rather than in either module because the wishlist writes it and
 * the itinerary reads it, and neither should have to import the other to agree
 * on the shape. `suggestion_tray.payload` is jsonb, so this is the only place
 * the structure is written down — parse defensively when reading it back.
 */
export interface TrayDraftItem {
  /**
   * Where it came from, so accepting twice can be detected. Null when nothing
   * saved proposed it — an assistant suggesting a place none of you had bookmarked
   * has no wishlist row to point at, and inventing one would claim an origin
   * that does not exist.
   */
  wishlist_id: string | null
  title: string
  place_name: string | null
  lat: number | null
  lng: number | null
  address: string | null
  maps_url: string | null
  category_id: string | null
  notes: string | null
  url: string | null
  /** Whose pick. Preserved through generation — that attribution matters. */
  proposed_by: string | null
}

export interface TrayDraftDay {
  date: string
  items: TrayDraftItem[]
}

export interface TrayDraft {
  kind: 'draft'
  pace: string
  note: string
  days: TrayDraftDay[]
  /** Days the generator left alone on purpose. */
  openDays: string[]
}
