/**
 * Module 14 — Settings. Pure, no React and no Supabase.
 *
 * The access rules live here as well as in SQL. That is deliberate
 * duplication, not an accident: the database is the enforcement point and the
 * only thing that actually stops a read, but the UI has to know the same rules
 * to explain them — to grey out the vault when a friend is being invited, and
 * to say *why*. Duplication would be a problem if one side could drift; the
 * shared list below is asserted against `all_modules()` in the RLS test.
 */
import type { MemberRole, ModuleName } from './types'

/** Mirrors `public.all_modules()`. Order is the order the UI lists them in. */
export const ALL_MODULES: ModuleName[] = [
  'trips',
  'wishlist',
  'destinations',
  'money',
  'photos',
  'flights',
  'documents',
  'allowance',
  'health',
]

/**
 * Mirrors `public.sensitive_modules()`.
 *
 * Documents hold passport and visa numbers. Allowance is somebody's
 * immigration history. Health is health. None is something to hand to a friend
 * along for one trip, and the database refuses to grant them rather than
 * trusting every future screen to remember.
 */
export const SENSITIVE_MODULES: ModuleName[] = ['documents', 'allowance', 'health']

/** What a friend or guest gets when nobody picks. Nothing sensitive in it. */
export const DEFAULT_GUEST_MODULES: ModuleName[] = ['trips', 'wishlist', 'destinations', 'photos']

export const MODULE_LABELS: Record<ModuleName, string> = {
  trips: 'Trips and the plan',
  wishlist: 'Wishlist',
  destinations: 'Destinations',
  money: 'Money',
  photos: 'Photos',
  flights: 'Flights',
  documents: 'Documents',
  allowance: 'Stay allowance',
  health: 'Health',
}

export const MODULE_DESCRIPTIONS: Record<ModuleName, string> = {
  trips: 'Dates, days, and everything planned into them.',
  wishlist: 'Saved places and what each of you thought of them.',
  destinations: 'Candidate cities and the comparison board.',
  money: 'Expenses, budgets and who owes whom.',
  photos: 'The shared library, albums and comments.',
  flights: 'Flight numbers, live status and the meeting timer.',
  documents: 'Passports, visas and insurance. Numbers and scans.',
  allowance: 'Days spent in each country, and how many are left.',
  health: 'Medication, conditions and emergency contacts.',
}

export function isSensitive(module: ModuleName): boolean {
  return SENSITIVE_MODULES.includes(module)
}

/** Roles that may see everything, invite people, and change shared settings. */
export function isOwning(role: MemberRole): boolean {
  return role === 'owner' || role === 'partner'
}

/**
 * Whether a role may be granted a module at all.
 *
 * The same rule `assert_grants_allowed` enforces. A UI that offered the vault
 * to a friend and then failed on save would be worse than one that never
 * offered it.
 */
export function canGrant(role: MemberRole, module: ModuleName): boolean {
  if (isOwning(role)) return true
  return !isSensitive(module)
}

/** What a member can actually see. Null grants mean everything. */
export function visibleModules(
  role: MemberRole,
  grants: ModuleName[] | null,
): ModuleName[] {
  if (grants === null) return isOwning(role) ? ALL_MODULES : []
  return ALL_MODULES.filter((m) => grants.includes(m) && canGrant(role, m))
}

export function canSee(
  module: ModuleName,
  role: MemberRole,
  grants: ModuleName[] | null,
): boolean {
  return visibleModules(role, grants).includes(module)
}

/**
 * Normalise a proposed grant list before it is sent.
 *
 * Drops anything the role may not hold and anything unrecognised, and returns
 * the result in `ALL_MODULES` order so two identical sets compare equal.
 */
export function normaliseGrants(role: MemberRole, grants: ModuleName[]): ModuleName[] {
  return ALL_MODULES.filter((m) => grants.includes(m) && canGrant(role, m))
}

/** A sentence for the access screen. Plain, and never a list of nine items. */
export function describeAccess(role: MemberRole, grants: ModuleName[] | null): string {
  if (isOwning(role) && grants === null) return 'Everything'
  const visible = visibleModules(role, grants)
  if (visible.length === 0) return 'Nothing yet'
  if (visible.length === ALL_MODULES.length) return 'Everything'
  if (visible.length <= 3) return visible.map((m) => MODULE_LABELS[m]).join(', ')
  return `${visible.length} of ${ALL_MODULES.length} modules`
}

export const ROLE_LABELS: Record<MemberRole, string> = {
  owner: 'Owner',
  partner: 'Partner',
  friend: 'Friend',
  guest: 'Guest',
}

export const ROLE_DESCRIPTIONS: Record<MemberRole, string> = {
  owner: 'Set this up. Sees everything.',
  partner: 'The other half of the couple. Sees everything.',
  friend: 'Along for the trips you choose. Never sees documents, allowance or health.',
  guest: 'One trip, and only what you tick. Never sees anything sensitive.',
}

/** Human copy for the invite failures the RPC raises. */
export const INVITE_ERRORS: Record<string, string> = {
  EMAIL_MISMATCH:
    'That code was sent to a different email address. Sign in with the address it was sent to, or ask for a new invite.',
  INVALID_CODE: 'That code is not valid. It may have been used already, or revoked.',
  EXPIRED_CODE: 'That invite has expired. Ask for a new one.',
  ALREADY_MEMBER: 'They are already here.',
  ALREADY_PAIRED: 'You are already in a couple. Leave it first.',
  COUPLE_FULL: 'This couple already has two people in it.',
  INVALID_EMAIL: 'That does not look like an email address.',
  NOT_ALLOWED: 'Only the two of you can invite anyone else.',
  SENSITIVE_MODULE_NOT_SHAREABLE:
    'Documents, stay allowance and health are never shared outside the couple.',
  UNKNOWN_MODULE: 'That is not something this app has.',
  INVITE_NEEDS_EMAIL: 'Invites now go to an email address. Send a new one.',
}
