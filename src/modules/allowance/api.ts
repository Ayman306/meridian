/** Module 10 — Stay Allowance. Supabase access only. */
'use client'

import { supabase } from '@/lib/supabase/client'
import { toAppError, unwrap, unwrapList } from '@/lib/errors'
import type { DateOnly } from '@/lib/dates'
import type { InsertDto, UpdateDto } from '@/types/database'
import type { AllowanceRule, EntryExitLog } from './types'

/**
 * Every rule this couple can see: the seeded defaults plus their own
 * overrides. RLS decides which is which; one query returns both because the
 * client has to compare them anyway to know which wins.
 */
export async function listRules(): Promise<AllowanceRule[]> {
  return unwrapList(await supabase.from('allowance_rules').select('*'))
}

export type RuleInput = Omit<
  InsertDto<'allowance_rules'>,
  'couple_id' | 'user_id' | 'id' | 'created_at' | 'updated_at'
>

/**
 * Create or replace this person's override for a destination.
 *
 * One per person per destination, so this upserts on that pair rather than
 * accumulating rules that quietly disagree with each other.
 */
export async function upsertRule(
  coupleId: string,
  userId: string,
  input: RuleInput,
): Promise<AllowanceRule> {
  const existing = unwrapList(
    await supabase
      .from('allowance_rules')
      .select('id')
      .eq('user_id', userId)
      .eq('destination_country', input.destination_country)
      .limit(1),
  )

  if (existing[0]) {
    return unwrap(
      await supabase
        .from('allowance_rules')
        .update(input)
        .eq('id', existing[0].id)
        .select('*')
        .single(),
    )
  }

  return unwrap(
    await supabase
      .from('allowance_rules')
      .insert({ ...input, couple_id: coupleId, user_id: userId })
      .select('*')
      .single(),
  )
}

/** Drop an override. The seeded default takes over again. */
export async function deleteRule(id: string): Promise<void> {
  const { error } = await supabase.from('allowance_rules').delete().eq('id', id)
  if (error) throw toAppError(error)
}

export async function listLog(coupleId: string): Promise<EntryExitLog[]> {
  return unwrapList(
    await supabase
      .from('entry_exit_log')
      .select('*')
      .eq('couple_id', coupleId)
      .order('entered_on', { ascending: false }),
  )
}

export interface LogEntryInput {
  countryCode: string
  enteredOn: DateOnly
  exitedOn: DateOnly | null
  tripId?: string | null
  isEstimated?: boolean
  notes?: string | null
}

export async function logEntry(
  coupleId: string,
  userId: string,
  input: LogEntryInput,
): Promise<EntryExitLog> {
  return unwrap(
    await supabase
      .from('entry_exit_log')
      .insert({
        couple_id: coupleId,
        user_id: userId,
        country_code: input.countryCode.toUpperCase(),
        entered_on: input.enteredOn,
        exited_on: input.exitedOn,
        trip_id: input.tripId ?? null,
        is_estimated: input.isEstimated ?? false,
        notes: input.notes ?? null,
      })
      .select('*')
      .single(),
  )
}

export async function updateLogEntry(
  id: string,
  patch: UpdateDto<'entry_exit_log'>,
): Promise<EntryExitLog> {
  return unwrap(
    await supabase.from('entry_exit_log').update(patch).eq('id', id).select('*').single(),
  )
}

/**
 * Hard delete, not soft.
 *
 * Everywhere else in this app a delete is recoverable, because losing a saved
 * restaurant is annoying. A wrong border crossing in an immigration record is
 * worse than a missing one: it silently eats someone's allowance. This row
 * should go.
 */
export async function deleteLogEntry(id: string): Promise<void> {
  const { error } = await supabase.from('entry_exit_log').delete().eq('id', id)
  if (error) throw toAppError(error)
}

/** Trips with dates and a chosen destination — what the suggestions read. */
export async function listTripsForSuggestions(coupleId: string): Promise<
  {
    id: string
    title: string
    start_date: string | null
    end_date: string | null
    date_precision: string
    country_code: string | null
    travellers: { user_id: string; arrival_date: string | null; departure_date: string | null }[]
  }[]
> {
  const trips = unwrapList(
    await supabase
      .from('trips')
      .select('id, title, start_date, end_date, date_precision')
      .eq('couple_id', coupleId)
      .eq('date_precision', 'exact')
      .is('deleted_at', null)
      .not('start_date', 'is', null)
      .order('start_date', { ascending: false })
      .limit(50),
  )
  if (trips.length === 0) return []

  const ids = trips.map((t) => t.id)
  const [destinations, travellers] = await Promise.all([
    supabase
      .from('trip_destinations')
      .select('trip_id, country_code')
      .in('trip_id', ids)
      .eq('state', 'chosen')
      .is('deleted_at', null),
    supabase.from('trip_travelers').select('trip_id, user_id, arrival_date, departure_date').in('trip_id', ids),
  ])

  const countryByTrip = new Map(
    unwrapList(destinations).map((d) => [d.trip_id, d.country_code]),
  )
  const travellersByTrip = new Map<string, LoggableTraveller[]>()
  for (const row of unwrapList(travellers)) {
    const list = travellersByTrip.get(row.trip_id) ?? []
    list.push({
      user_id: row.user_id,
      arrival_date: row.arrival_date,
      departure_date: row.departure_date,
    })
    travellersByTrip.set(row.trip_id, list)
  }

  return trips.map((trip) => ({
    ...trip,
    country_code: countryByTrip.get(trip.id) ?? null,
    travellers: travellersByTrip.get(trip.id) ?? [],
  }))
}

interface LoggableTraveller {
  user_id: string
  arrival_date: string | null
  departure_date: string | null
}
