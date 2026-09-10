/** Module 14 — Settings. Supabase access only; no React in here. */
'use client'

import { supabase } from '@/lib/supabase/client'
import { toAppError, unwrap, unwrapList, unwrapMaybe } from '@/lib/errors'
import type { UpdateDto } from '@/types/database'
import type { StoredSubscription } from '@/lib/push/client'
import type {
  McpGrant,
  CoupleSettings,
  Invite,
  InviteInput,
  Member,
  MemberRole,
  ModuleName,
  UserSettings,
} from './types'

export async function getCoupleSettings(coupleId: string): Promise<CoupleSettings | null> {
  return unwrapMaybe(
    await supabase.from('couple_settings').select('*').eq('couple_id', coupleId).maybeSingle(),
  )
}

export async function getUserSettings(userId: string): Promise<UserSettings | null> {
  return unwrapMaybe(
    await supabase.from('user_settings').select('*').eq('user_id', userId).maybeSingle(),
  )
}

export async function updateCoupleSettings(
  coupleId: string,
  patch: UpdateDto<'couple_settings'>,
): Promise<CoupleSettings> {
  return unwrap(
    await supabase
      .from('couple_settings')
      .update(patch)
      .eq('couple_id', coupleId)
      .select('*')
      .single(),
  )
}

export async function updateUserSettings(
  userId: string,
  patch: UpdateDto<'user_settings'>,
): Promise<UserSettings> {
  return unwrap(
    await supabase.from('user_settings').update(patch).eq('user_id', userId).select('*').single(),
  )
}

/**
 * What the caller may see, straight from the database.
 *
 * Read rather than derived from a local role, so a hidden nav item and an
 * unreadable table can never disagree: both answer to `couple_members`.
 */
export async function getMyModules(): Promise<ModuleName[]> {
  const { data, error } = await supabase.rpc('my_modules')
  if (error) throw toAppError(error)
  return (data ?? []) as ModuleName[]
}

export async function getMyRole(): Promise<MemberRole | null> {
  const { data, error } = await supabase.rpc('my_role')
  if (error) throw toAppError(error)
  return (data as MemberRole | null) ?? null
}

export async function listMembers(coupleId: string): Promise<Member[]> {
  const rows = unwrapList(
    await supabase
      .from('couple_members')
      .select('user_id, role, module_grants, invited_by, joined_at')
      .eq('couple_id', coupleId),
  )
  return rows.map((r) => ({
    userId: r.user_id,
    role: r.role as MemberRole,
    grants: (r.module_grants as ModuleName[] | null) ?? null,
    invitedBy: r.invited_by,
    joinedAt: r.joined_at,
  }))
}

/**
 * Change what one member can see.
 *
 * The database re-checks the sensitive-module rule on write, so a stale client
 * cannot widen a friend's access by sending a list the UI would not have
 * offered.
 */
export async function setMemberGrants(
  coupleId: string,
  userId: string,
  grants: ModuleName[] | null,
): Promise<void> {
  const { error } = await supabase
    .from('couple_members')
    .update({ module_grants: grants })
    .eq('couple_id', coupleId)
    .eq('user_id', userId)
  if (error) throw toAppError(error)
}

export async function removeMember(coupleId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('couple_members')
    .delete()
    .eq('couple_id', coupleId)
    .eq('user_id', userId)
  if (error) throw toAppError(error)
}

export async function listInvites(coupleId: string): Promise<Invite[]> {
  return unwrapList(
    await supabase
      .from('invites')
      .select('*')
      .eq('couple_id', coupleId)
      .is('accepted_at', null)
      .is('revoked_at', null)
      .order('created_at', { ascending: false }),
  )
}

/**
 * Issue an invite to an address.
 *
 * The code alone no longer admits anyone: `join_couple` compares the address
 * on the account signing in against this one. Everything is validated inside
 * the RPC transaction, never here.
 */
export async function createInvite(input: InviteInput): Promise<Invite> {
  const { data, error } = await supabase.rpc('create_invite', {
    email: input.email,
    member_role: input.role,
    // The RPC's argument has a SQL default, so null and "omitted" are the
    // same thing to it but different to the generated type.
    grants: input.grants ?? undefined,
    valid_days: input.validDays ?? 7,
  })
  if (error) throw toAppError(error)
  return data as Invite
}

export async function revokeInvite(id: string): Promise<void> {
  const { error } = await supabase
    .from('invites')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw toAppError(error)
}

export async function acceptInvite(code: string): Promise<string> {
  const { data, error } = await supabase.rpc('join_couple', { code })
  if (error) throw toAppError(error)
  return data as string
}

// ---------------------------------------------------------------------------
// Assistant grants — which modules an approved app may reach
// ---------------------------------------------------------------------------
//
// There are no tokens here any more. Supabase Auth issues, refreshes and
// revokes those; 0032 deleted our copy. What is left is the one question OAuth
// scopes cannot answer — which modules this person ticked for this app — and
// that is all these three functions touch.

const GRANT_COLUMNS = 'id, client_id, client_name, modules, created_at, last_used_at'

export async function listGrants(): Promise<McpGrant[]> {
  // RLS narrows this to the caller's own rows. Nothing in the table is a
  // credential, so unlike the tokens it replaced, every column is readable by
  // the person it belongs to.
  return unwrapList(
    await supabase
      .from('mcp_grants')
      .select(GRANT_COLUMNS)
      .order('created_at', { ascending: false }),
  )
}

/**
 * Record what somebody just approved on the consent screen.
 *
 * Upsert on `(user_id, client_id)`: approving the same app twice is a person
 * changing their mind about the modules, not a second grant that contradicts
 * the first.
 */
export async function saveGrant(
  input: { clientId: string; clientName: string | null; modules: ModuleName[] },
  userId: string,
): Promise<McpGrant> {
  return unwrap(
    await supabase
      .from('mcp_grants')
      .upsert(
        {
          user_id: userId,
          client_id: input.clientId,
          client_name: input.clientName,
          modules: input.modules,
        },
        { onConflict: 'user_id,client_id' },
      )
      .select(GRANT_COLUMNS)
      .single(),
  )
}

/**
 * Take an app's access away.
 *
 * Deleted rather than soft-deleted, which is the opposite of what the token
 * table did — and right for a different reason. A revoked token was worth
 * keeping because `last_used_at` was evidence about a credential that might
 * have been copied. A grant holds no credential: revoking it is the person
 * saying "not this app any more", and a tombstone would only clutter the list
 * they revoked it from.
 *
 * The token itself dies at Supabase, which is also where it was born.
 */
export async function revokeGrant(id: string): Promise<void> {
  const { error } = await supabase.from('mcp_grants').delete().eq('id', id)
  if (error) throw toAppError(error)
}

// ---------------------------------------------------------------------------
// Push subscriptions — one row per browser, owned by the person using it
// ---------------------------------------------------------------------------

/**
 * Register this browser for push.
 *
 * Upsert on `endpoint`, which is the table's unique key: re-subscribing the
 * same browser must refresh the keys rather than collide, and a browser that
 * rotated its subscription arrives with a new endpoint and gets a new row.
 */
export async function savePushSubscription(
  subscription: StoredSubscription,
  userId: string,
): Promise<void> {
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: userId,
      endpoint: subscription.endpoint,
      keys: subscription.keys,
      user_agent: subscription.userAgent,
    },
    { onConflict: 'endpoint' },
  )
  if (error) throw toAppError(error)
}

export async function deletePushSubscription(endpoint: string): Promise<void> {
  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)
  if (error) throw toAppError(error)
}

/** How many browsers this person has registered. Shown in Settings. */
export async function countPushSubscriptions(): Promise<number> {
  const { count, error } = await supabase
    .from('push_subscriptions')
    .select('id', { count: 'exact', head: true })
  if (error) throw toAppError(error)
  return count ?? 0
}

// ---------------------------------------------------------------------------
// Category management (spec 14.2)
// ---------------------------------------------------------------------------

/**
 * The four lists a couple can rename and recolour.
 *
 * They live in four tables with four different shapes, which is why this is a
 * discriminated set rather than one generic helper: `trip_statuses` has no
 * colour, `document_types` has flags instead of one, and pretending otherwise
 * would mean a form that offers a colour picker for something with nowhere to
 * put the answer.
 */
export type CategoryKind =
  | 'categories'
  | 'expense_categories'
  | 'document_types'
  | 'trip_statuses'

export interface EditableCategory {
  id: string
  name: string
  color: string | null
  isDefault: boolean
  sortOrder: number
}

const HAS_COLOR: Record<CategoryKind, boolean> = {
  categories: true,
  expense_categories: true,
  document_types: false,
  trip_statuses: true,
}

export function supportsColor(kind: CategoryKind): boolean {
  return HAS_COLOR[kind]
}

export async function listCategoriesOf(
  kind: CategoryKind,
  coupleId: string,
): Promise<EditableCategory[]> {
  const rows = unwrapList(
    await supabase.from(kind).select('*').eq('couple_id', coupleId).order('sort_order'),
  )

  return rows.map((row) => {
    const record = row as Record<string, unknown>
    return {
      id: String(record.id),
      name: String(record.name ?? ''),
      color: HAS_COLOR[kind] ? ((record.color as string | null) ?? null) : null,
      isDefault: Boolean(record.is_default),
      sortOrder: Number(record.sort_order ?? 0),
    }
  })
}

export async function renameCategory(
  kind: CategoryKind,
  id: string,
  patch: { name?: string; color?: string | null },
): Promise<void> {
  const update: { name?: string; color?: string | null } = {}
  if (patch.name !== undefined) update.name = patch.name
  // Never send a colour to a table that has no column for it: PostgREST would
  // reject the whole statement and the rename would be lost with it.
  if (patch.color !== undefined && HAS_COLOR[kind]) update.color = patch.color
  if (Object.keys(update).length === 0) return

  // The four tables have four generated row types, and `kind` is only known at
  // runtime, so the client cannot narrow the update to one of them. The cast is
  // sound because of the guard above: `name` exists on all four, and `color` is
  // only ever present when HAS_COLOR says the table has it.
  const { error } = await supabase
    .from(kind)
    .update(update as never)
    .eq('id', id)
  if (error) throw toAppError(error)
}

/**
 * Add one.
 *
 * `is_default` is never set here. A default is something the seed created and
 * the app may rely on by name; one somebody adds is theirs, and marking it
 * default would let a later reseed treat it as replaceable.
 */
export async function addCategory(
  kind: CategoryKind,
  coupleId: string,
  name: string,
  color: string | null,
): Promise<void> {
  const row: { couple_id: string; name: string; color?: string } = { couple_id: coupleId, name }
  if (HAS_COLOR[kind] && color) row.color = color

  // Same reasoning as `renameCategory` above.
  const { error } = await supabase.from(kind).insert(row as never)
  if (error) throw toAppError(error)
}

/**
 * Remove one.
 *
 * Every table referencing these uses `on delete set null`, so removing a
 * category unfiles what used it rather than deleting it. That is worth saying
 * in the UI, and it is why this is allowed at all — a delete that took the
 * expenses with it would not be.
 */
export async function removeCategory(kind: CategoryKind, id: string): Promise<void> {
  const { error } = await supabase.from(kind).delete().eq('id', id)
  if (error) throw toAppError(error)
}
