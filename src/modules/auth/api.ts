/** Module 1 — Auth & Couple. Supabase access only; no React in here. */
'use client'

import { supabase } from '@/lib/supabase/client'
import { toAppError, unwrap, unwrapMaybe, AppError } from '@/lib/errors'
import { DEFAULT_ACCENT, type AccentColor } from '@/lib/constants'
import type { Couple, Profile } from '@/types/domain'
import type { Tables, UpdateDto } from '@/types/database'

function toProfile(row: Tables<'profiles'>): Profile {
  return { ...row, accent_color: (row.accent_color as AccentColor) ?? DEFAULT_ACCENT }
}

export async function signInWithGoogle(redirectTo = `${window.location.origin}/`): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      // openid/email/profile only — all non-sensitive, so Google requires no
      // app verification. Do not add scopes without revisiting that.
      scopes: 'openid email profile',
      queryParams: { prompt: 'select_account' },
    },
  })
  if (error) throw toAppError(error)
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut()
  if (error) throw toAppError(error)
}

export async function getProfile(userId: string): Promise<Profile | null> {
  const row = unwrapMaybe(
    await supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
  )
  return row ? toProfile(row) : null
}

/** The caller's couple, or null in solo mode. */
export async function getCouple(): Promise<Couple | null> {
  return unwrapMaybe(await supabase.from('couples').select('*').limit(1).maybeSingle())
}

/** The other member's profile. Null in solo mode or if they deleted their account. */
export async function getPartner(): Promise<Profile | null> {
  const { data: partnerId, error } = await supabase.rpc('partner_id')
  if (error) throw toAppError(error)
  if (!partnerId) return null
  return getProfile(partnerId)
}

export async function createCouple(name?: string): Promise<Couple> {
  const { data, error } = await supabase.rpc('create_couple', { couple_name: name ?? null })
  if (error) throw toAppError(error)
  if (!data) throw new AppError('Could not create your couple.', { kind: 'unknown' })
  return data as Couple
}

/** Join by invite code. All validation happens inside the RPC transaction. */
export async function joinCouple(code: string): Promise<string> {
  const { data, error } = await supabase.rpc('join_couple', { code })
  if (error) throw toAppError(error)
  return data as string
}

export async function regenerateInviteCode(): Promise<string> {
  const { data, error } = await supabase.rpc('regenerate_invite_code')
  if (error) throw toAppError(error)
  return data as string
}

export async function leaveCouple(): Promise<void> {
  const { error } = await supabase.rpc('leave_couple')
  if (error) throw toAppError(error)
}

export async function updateProfile(
  userId: string,
  patch: UpdateDto<'profiles'>,
): Promise<Profile> {
  const row = unwrap(
    await supabase.from('profiles').update(patch).eq('id', userId).select('*').single(),
  )
  return toProfile(row)
}

export async function updateCouple(
  coupleId: string,
  patch: { name?: string | null; anniversary_date?: string | null },
): Promise<Couple> {
  return unwrap(await supabase.from('couples').update(patch).eq('id', coupleId).select('*').single())
}
