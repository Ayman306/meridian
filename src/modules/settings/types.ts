import type { Tables } from '@/types/database'

export type CoupleSettings = Tables<'couple_settings'>
export type UserSettings = Tables<'user_settings'>
export type Invite = Tables<'invites'>
export type PushSubscriptionRow = Tables<'push_subscriptions'>

/** Every module the app can hide or show. Mirrors `all_modules()` in SQL. */
export type ModuleName =
  | 'trips'
  | 'wishlist'
  | 'destinations'
  | 'money'
  | 'documents'
  | 'photos'
  | 'flights'
  | 'allowance'
  | 'health'

export type MemberRole = 'owner' | 'partner' | 'friend' | 'guest'

/** A member of the space, with what they can see. */
export interface Member {
  userId: string
  role: MemberRole
  /** Null means everything — the default for the two people it belongs to. */
  grants: ModuleName[] | null
  invitedBy: string | null
  joinedAt: string
}

export interface InviteInput {
  email: string
  role: Exclude<MemberRole, 'owner'>
  grants: ModuleName[] | null
  validDays?: number
}

/**
 * A personal access token, as the owner sees it.
 *
 * No `token_hash` — the column is revoked from `authenticated` at the database
 * level (0019), so it is not merely omitted from this type, it cannot be
 * selected. The raw token exists once, in the browser that made it.
 */
/**
 * A credential as its owner sees it.
 *
 * The three hash columns are omitted rather than merely unselected: 0019 and
 * 0030 revoke the SELECT grant on each of them, so asking for one fails at the
 * database. Keeping them out of the type means a screen cannot try.
 */
export type AccessToken = Omit<
  Tables<'access_tokens'>,
  'token_hash' | 'user_id' | 'refresh_token_hash' | 'previous_refresh_hash'
>

export interface AccessTokenInput {
  name: string
  modules: ModuleName[]
  /** Null means it does not expire on its own; revoking is then the only end. */
  expiresInDays: number | null
}
