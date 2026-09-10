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
 * An app this person approved, as they see it in Settings.
 *
 * Every column is readable, which is new. The table this replaced held token
 * hashes and had its SELECT grant revoked column by column; this one holds no
 * credential at all — Supabase Auth owns those — so there is nothing to hide
 * from its owner.
 */
export type McpGrant = Pick<
  Tables<'mcp_grants'>,
  'id' | 'client_id' | 'client_name' | 'modules' | 'created_at' | 'last_used_at'
>
