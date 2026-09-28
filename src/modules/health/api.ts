/**
 * Module 12 — Health. Supabase access only; no React in here.
 *
 * Every read below is scoped by `owner_id` in the query *and* by RLS. The
 * filter is a courtesy that keeps the payload small; the policy is what makes
 * it private. Removing the filter would change nothing about what comes back.
 */
'use client'

import { supabase } from '@/lib/supabase/client'
import { AppError, toAppError, unwrap, unwrapList } from '@/lib/errors'
import type { InsertDto, UpdateDto } from '@/types/database'
import type { DateOnly } from '@/lib/dates'
import type {
  ConsentScope,
  CycleLog,
  HealthConsent,
  HealthRecord,
  IntimacyLog,
  MedicationRestriction,
  RecordKind,
  WellnessTip,
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

// ---------------------------------------------------------------------------
// Intimacy
// ---------------------------------------------------------------------------

/**
 * One owner's log, newest first.
 *
 * Reading somebody else's returns nothing at all unless they have granted the
 * `intimacy` scope — enforced by RLS, not here. This function does not know
 * whose id it was handed and does not need to.
 */
export async function listIntimacy(ownerId: string, from?: DateOnly): Promise<IntimacyLog[]> {
  let query = supabase
    .from('intimacy_logs')
    .select('*')
    .eq('owner_id', ownerId)
    .order('logged_on', { ascending: false })
  if (from) query = query.gte('logged_on', from)
  return unwrapList(await query)
}

/**
 * A new day. Insert, not upsert: the one-row-per-day constraint is what turns
 * a stale form into an error instead of a silent overwrite. `planDaySave`
 * decides beforehand whether this is the right call.
 */
export async function createIntimacy(
  ownerId: string,
  input: Omit<InsertDto<'intimacy_logs'>, 'owner_id'>,
): Promise<IntimacyLog> {
  return unwrap(
    await supabase
      .from('intimacy_logs')
      .insert({ ...input, owner_id: ownerId })
      .select('*')
      .single(),
  )
}

/** One existing row, by id — so changing its date moves it. */
export async function updateIntimacy(
  id: string,
  patch: UpdateDto<'intimacy_logs'>,
): Promise<IntimacyLog> {
  return unwrap(
    await supabase.from('intimacy_logs').update(patch).eq('id', id).select('*').single(),
  )
}

/** Hard delete, as everywhere in this module. */
export async function deleteIntimacy(id: string): Promise<void> {
  const { error } = await supabase.from('intimacy_logs').delete().eq('id', id)
  if (error) throw toAppError(error)
}

/**
 * The shared seeded set, plus the couple's own tips and any drafts waiting for
 * them (0040). RLS decides which couple rows come back — partners only, never
 * a friend — so no filter by couple is needed here, and none would widen it.
 */
export async function listWellnessTips(): Promise<WellnessTip[]> {
  return unwrapList(
    await supabase
      .from('wellness_tips')
      .select('*')
      .is('deleted_at', null)
      .order('category')
      .order('title'),
  )
}

export interface WellnessTipInput {
  title: string
  body: string
  category: string
  audience: string
  source_url: string
}

/**
 * A tip a partner types in. The database publishes it and records who wrote
 * it; `verified_on` is the day it was written down, the same meaning it has
 * on the seeded rows.
 */
export async function createWellnessTip(
  coupleId: string,
  input: WellnessTipInput,
  writtenOn: DateOnly,
): Promise<WellnessTip> {
  return unwrap(
    await supabase
      .from('wellness_tips')
      .insert({ couple_id: coupleId, ...input, verified_on: writtenOn })
      .select('*')
      .single(),
  )
}

export async function updateWellnessTip(
  id: string,
  patch: Partial<WellnessTipInput> & { verified_on?: DateOnly },
): Promise<WellnessTip> {
  return changed(
    await supabase.from('wellness_tips').update(patch).eq('id', id).select('*').maybeSingle(),
  )
}

/** Keep an assistant's draft. The database records who kept it and when. */
export async function keepWellnessTip(id: string): Promise<WellnessTip> {
  return changed(
    await supabase
      .from('wellness_tips')
      .update({ status: 'published' })
      .eq('id', id)
      .eq('status', 'draft')
      .select('*')
      .maybeSingle(),
  )
}

/** Soft delete, for a kept tip and a discarded draft alike. */
export async function removeWellnessTip(id: string): Promise<void> {
  changed(
    await supabase
      .from('wellness_tips')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .select('id')
      .maybeSingle(),
  )
}

/**
 * An update RLS filtered to nothing reports success with no row. Say so, the
 * way Settings does since D138, rather than let a no-op look like it worked.
 */
function changed<T>(result: { data: T | null; error: unknown }): T {
  if (result.error) throw toAppError(result.error)
  if (result.data === null) {
    throw new AppError('That tip could not be changed — it may already have been removed.', {
      kind: 'permission',
    })
  }
  return result.data
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
  const [cycles, records, intimacy, consents] = await Promise.all([
    listCycles(ownerId),
    listRecords(ownerId),
    // Included for the same reason it is included in the hard delete: an
    // export that quietly omitted a table would be a false account of what
    // this app holds about somebody.
    listIntimacy(ownerId),
    listConsents(),
  ])
  const bundle = {
    exported_at: new Date().toISOString(),
    owner_id: ownerId,
    cycle_logs: cycles,
    health_records: records,
    intimacy_logs: intimacy,
    health_consents: consents,
  }
  return new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
}
