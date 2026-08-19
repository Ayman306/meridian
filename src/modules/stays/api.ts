/** Module — Accommodations. Supabase access only. */
'use client'

import { supabase } from '@/lib/supabase/client'
import { unwrap, unwrapList } from '@/lib/errors'
import type { InsertDto, UpdateDto } from '@/types/database'
import type { Accommodation } from './types'

export async function listStays(tripId: string): Promise<Accommodation[]> {
  return unwrapList(
    await supabase
      .from('accommodations')
      .select('*')
      .eq('trip_id', tripId)
      .is('deleted_at', null)
      .order('check_in', { ascending: true, nullsFirst: false }),
  )
}

export type StayInput = Omit<
  InsertDto<'accommodations'>,
  'couple_id' | 'trip_id' | 'id' | 'created_by'
>

export async function addStay(
  coupleId: string,
  tripId: string,
  userId: string,
  input: StayInput,
): Promise<Accommodation> {
  return unwrap(
    await supabase
      .from('accommodations')
      .insert({ ...input, couple_id: coupleId, trip_id: tripId, created_by: userId })
      .select('*')
      .single(),
  )
}

export async function updateStay(
  id: string,
  patch: UpdateDto<'accommodations'>,
): Promise<Accommodation> {
  return unwrap(
    await supabase.from('accommodations').update(patch).eq('id', id).select('*').single(),
  )
}

/**
 * Soft delete, like everything else somebody would regret losing.
 *
 * A booking reference is the one thing you cannot reconstruct from memory at a
 * front desk, so a mis-tap here has to be recoverable.
 */
export async function removeStay(id: string): Promise<void> {
  await unwrap(
    await supabase
      .from('accommodations')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .select('id')
      .single(),
  )
}
