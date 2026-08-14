/** Module 14 — Settings. Supabase access only; no React in here. */
'use client'

import { supabase } from '@/lib/supabase/client'
import { toAppError, unwrap, unwrapList, unwrapMaybe } from '@/lib/errors'
import type { UpdateDto } from '@/types/database'
import type {
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
