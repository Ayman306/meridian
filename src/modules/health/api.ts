/**
 * Module 12 — Health. Supabase access only; no React in here.
 *
 * Every read below is scoped by `owner_id` in the query *and* by RLS. The
 * filter is a courtesy that keeps the payload small; the policy is what makes
 * it private. Removing the filter would change nothing about what comes back.
 */
'use client'

import { supabase } from '@/lib/supabase/client'
import { toAppError, unwrap, unwrapList } from '@/lib/errors'
import type { InsertDto, UpdateDto } from '@/types/database'
import type {
  ConsentScope,
  CycleLog,
  HealthConsent,
  HealthRecord,
  MedicationRestriction,
  RecordKind,
} from './types'

export async function listConsents(): Promise<HealthConsent[]> {
  // Only the owner can read this table at all, so no filter is needed and
  // none would help: a viewer gets zero rows either way.
  return unwrapList(await supabase.from('health_consents').select('*'))
}

/**
 * Grant a scope.
 *
 * Upserts on the unique triple so re-granting something previously revoked
 * clears `revoked_at` rather than colliding with the old row.
 */
export async function grantConsent(
  ownerId: string,
  viewerId: string,
  scope: ConsentScope,
): Promise<void> {
  const { error } = await supabase.from('health_consents').upsert(
    { owner_id: ownerId, viewer_id: viewerId, scope, revoked_at: null, granted_at: new Date().toISOString() },
    { onConflict: 'owner_id,viewer_id,scope' },
  )
  if (error) throw toAppError(error)
}

/**
 * Revoke one.
 *
 * One write, no confirmation, and it takes effect on the partner's next query
 * because the policy checks `revoked_at` itself. Spec 12.2 asks for exactly
 * this: no friction, and no notification pressure on the owner.
 */
export async function revokeConsent(
  ownerId: string,
  viewerId: string,
  scope: ConsentScope,
): Promise<void> {
  const { error } = await supabase
    .from('health_consents')
    .update({ revoked_at: new Date().toISOString() })
    .eq('owner_id', ownerId)
    .eq('viewer_id', viewerId)
    .eq('scope', scope)
  if (error) throw toAppError(error)
}

export async function listCycles(ownerId: string): Promise<CycleLog[]> {
  return unwrapList(
    await supabase
      .from('cycle_logs')
      .select('*')
      .eq('owner_id', ownerId)
      .order('started_on', { ascending: false }),
  )
}

export async function logCycle(
  ownerId: string,
  input: Omit<InsertDto<'cycle_logs'>, 'owner_id'>,
): Promise<CycleLog> {
  return unwrap(
    await supabase
      .from('cycle_logs')
      .insert({ ...input, owner_id: ownerId })
      .select('*')
      .single(),
  )
}

export async function updateCycle(
  id: string,
  patch: UpdateDto<'cycle_logs'>,
): Promise<CycleLog> {
  return unwrap(await supabase.from('cycle_logs').update(patch).eq('id', id).select('*').single())
}

/** Hard delete. There is no soft-delete anywhere in this module. */
export async function deleteCycle(id: string): Promise<void> {
  const { error } = await supabase.from('cycle_logs').delete().eq('id', id)
  if (error) throw toAppError(error)
}

export async function listRecords(ownerId: string, kind?: RecordKind): Promise<HealthRecord[]> {
  let query = supabase
    .from('health_records')
    .select('*')
    .eq('owner_id', ownerId)
    .order('label', { ascending: true })
  if (kind) query = query.eq('kind', kind)
  return unwrapList(await query)
}

export async function addRecord(
  ownerId: string,
  input: Omit<InsertDto<'health_records'>, 'owner_id'>,
): Promise<HealthRecord> {
  return unwrap(
    await supabase
      .from('health_records')
      .insert({ ...input, owner_id: ownerId })
      .select('*')
      .single(),
  )
}

export async function updateRecord(
  id: string,
  patch: UpdateDto<'health_records'>,
): Promise<HealthRecord> {
  return unwrap(
    await supabase.from('health_records').update(patch).eq('id', id).select('*').single(),
  )
}

export async function deleteRecord(id: string): Promise<void> {
  const { error } = await supabase.from('health_records').delete().eq('id', id)
  if (error) throw toAppError(error)
}

export async function listRestrictions(countryCode: string): Promise<MedicationRestriction[]> {
  return unwrapList(
    await supabase.from('medication_restrictions').select('*').eq('country_code', countryCode),
  )
}

/**
 * Hard delete, in one transaction.
 *
 * An RPC rather than three client deletes: a delete that removed the cycle
 * logs, failed, and left the consents behind would leave somebody believing
 * they had erased something they had not.
 */
export async function deleteAllHealthData(): Promise<void> {
  const { error } = await supabase.rpc('delete_all_health_data')
  if (error) throw toAppError(error)
}

/** Everything the owner has, as JSON. Spec 12.2. */
export async function exportHealthData(ownerId: string): Promise<Blob> {
  const [cycles, records, consents] = await Promise.all([
    listCycles(ownerId),
    listRecords(ownerId),
    listConsents(),
  ])
  const bundle = {
    exported_at: new Date().toISOString(),
    owner_id: ownerId,
    cycle_logs: cycles,
    health_records: records,
    health_consents: consents,
  }
  return new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
}
