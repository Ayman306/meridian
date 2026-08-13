/** Module 3 — Trips. Supabase access only. */
'use client'

import { supabase } from '@/lib/supabase/client'
import { toAppError, unwrap, unwrapList, unwrapMaybe } from '@/lib/errors'
import type { DateOnly } from '@/lib/dates'
import type { DatePrecision, DayType, Trip, TripDay, TripDetail, TripStatus, TripSummary, TripTraveler } from './types'
import type { InsertDto, UpdateDto } from '@/types/database'

const TRIP_COLUMNS = '*'

export async function listTripStatuses(coupleId: string): Promise<TripStatus[]> {
  const rows = unwrapList(
    await supabase
      .from('trip_statuses')
      .select('*')
      .eq('couple_id', coupleId)
      .order('sort_order', { ascending: true }),
  )

  // A couple created before the statuses existed has none; seed on first read
  // rather than making every screen handle the empty case.
  if (rows.length === 0) {
    const { error } = await supabase.rpc('seed_trip_statuses', { target: coupleId })
    if (error) throw toAppError(error)
    return unwrapList(
      await supabase
        .from('trip_statuses')
        .select('*')
        .eq('couple_id', coupleId)
        .order('sort_order', { ascending: true }),
    )
  }

  return rows
}

export async function listTrips(coupleId: string): Promise<TripSummary[]> {
  const trips = unwrapList(
    await supabase
      .from('trips')
      .select(TRIP_COLUMNS)
      .eq('couple_id', coupleId)
      .is('deleted_at', null)
      .order('start_date', { ascending: true, nullsFirst: false }),
  )
  if (trips.length === 0) return []

  const ids = trips.map((t) => t.id)
  const [statuses, travelers] = await Promise.all([
    listTripStatuses(coupleId),
    unwrapList(await supabase.from('trip_travelers').select('*').in('trip_id', ids)),
  ])

  const statusById = new Map(statuses.map((s) => [s.id, s]))
  const travelersByTrip = new Map<string, TripTraveler[]>()
  for (const t of travelers) {
    const list = travelersByTrip.get(t.trip_id) ?? []
    list.push(t)
    travelersByTrip.set(t.trip_id, list)
  }

  return trips.map((trip) => ({
    ...trip,
    status: trip.status_id ? (statusById.get(trip.status_id) ?? null) : null,
    travelers: travelersByTrip.get(trip.id) ?? [],
  }))
}

/** Soft-deleted trips, restorable for 30 days. */
export async function listDeletedTrips(coupleId: string): Promise<Trip[]> {
  return unwrapList(
    await supabase
      .from('trips')
      .select(TRIP_COLUMNS)
      .eq('couple_id', coupleId)
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false }),
  )
}

export async function getTrip(id: string): Promise<TripDetail | null> {
  const trip = unwrapMaybe(
    await supabase.from('trips').select('*').eq('id', id).is('deleted_at', null).maybeSingle(),
  )
  if (!trip) return null

  // Three independent reads — issue them together, not in sequence.
  const [travelersRes, daysRes, statusRes] = await Promise.all([
    supabase.from('trip_travelers').select('*').eq('trip_id', id),
    supabase.from('trip_days').select('*').eq('trip_id', id).order('date', { ascending: true }),
    trip.status_id
      ? supabase.from('trip_statuses').select('*').eq('id', trip.status_id).maybeSingle()
      : null,
  ])

  return {
    ...trip,
    status: statusRes ? unwrapMaybe(statusRes) : null,
    travelers: unwrapList(travelersRes),
    days: unwrapList(daysRes),
  }
}

export interface CreateTripInput {
  couple_id: string
  title: string
  start_date?: DateOnly | null
  end_date?: DateOnly | null
  date_precision?: DatePrecision
  is_open_ended?: boolean
  status_id?: string | null
  notes?: string | null
}

export async function createTrip(input: CreateTripInput): Promise<Trip> {
  const { data: userData } = await supabase.auth.getUser()

  const payload: InsertDto<'trips'> = {
    couple_id: input.couple_id,
    title: input.title,
    start_date: input.start_date ?? null,
    end_date: input.end_date ?? null,
    date_precision: input.date_precision ?? 'unknown',
    is_open_ended: input.is_open_ended ?? false,
    status_id: input.status_id ?? null,
    notes: input.notes ?? null,
    created_by: userData.user?.id ?? null,
  }

  const trip = unwrap(await supabase.from('trips').insert(payload).select(TRIP_COLUMNS).single())

  // Both partners are travelers by default; they can adjust their own dates.
  await seedTravelers(trip.id)
  if (trip.start_date) await syncTripDays(trip.id)

  return trip
}

/** Add both members as travelers, defaulting to the trip's own dates. */
async function seedTravelers(tripId: string): Promise<void> {
  const { data: coupleId, error } = await supabase.rpc('my_couple_id')
  if (error) throw toAppError(error)
  if (!coupleId) return

  const members = unwrapList(
    await supabase.from('couple_members').select('user_id').eq('couple_id', coupleId),
  )
  if (members.length === 0) return

  const { error: insertError } = await supabase
    .from('trip_travelers')
    .upsert(
      members.map((m) => ({ trip_id: tripId, user_id: m.user_id })),
      { onConflict: 'trip_id,user_id', ignoreDuplicates: true },
    )
  if (insertError) throw toAppError(insertError)
}

export async function updateTrip(id: string, patch: UpdateDto<'trips'>): Promise<Trip> {
  return unwrap(await supabase.from('trips').update(patch).eq('id', id).select(TRIP_COLUMNS).single())
}

/**
 * Regenerate the day grid to match the trip's dates. Returns how many days were
 * removed — the caller should have already prompted if any of them were in use.
 */
export async function syncTripDays(tripId: string): Promise<number> {
  const { data, error } = await supabase.rpc('sync_trip_days', { target: tripId })
  if (error) throw toAppError(error)
  return data ?? 0
}

export async function setTripDates(
  id: string,
  start: DateOnly | null,
  end: DateOnly | null,
  precision: DatePrecision,
  isOpenEnded = false,
): Promise<Trip> {
  const trip = await updateTrip(id, {
    start_date: start,
    end_date: isOpenEnded ? null : end,
    date_precision: precision,
    is_open_ended: isOpenEnded,
  })
  await syncTripDays(id)
  return trip
}

export async function setTravelerDates(
  tripId: string,
  userId: string,
  patch: { arrival_date?: DateOnly | null; departure_date?: DateOnly | null; origin_airport?: string | null },
): Promise<TripTraveler> {
  return unwrap(
    await supabase
      .from('trip_travelers')
      .upsert({ trip_id: tripId, user_id: userId, ...patch }, { onConflict: 'trip_id,user_id' })
      .select('*')
      .single(),
  )
}

export async function setDayType(tripId: string, date: DateOnly, dayType: DayType): Promise<TripDay> {
  return unwrap(
    await supabase
      .from('trip_days')
      .upsert({ trip_id: tripId, date, day_type: dayType }, { onConflict: 'trip_id,date' })
      .select('*')
      .single(),
  )
}

/**
 * How many itinerary items sit on each day, so the shortening prompt can name
 * what is at stake.
 *
 * This calls the RPC directly rather than importing the itinerary module: the
 * itinerary module already imports trips, and a cycle between the two would be
 * worse than one duplicated four-line call.
 */
export async function itemCountsByDay(tripId: string): Promise<Record<string, number>> {
  const { data, error } = await supabase.rpc('trip_item_counts_by_day', { target: tripId })
  if (error) throw toAppError(error)
  const out: Record<string, number> = {}
  for (const row of data ?? []) out[row.date] = Number(row.item_count)
  return out
}

/** Soft delete. Photos are deliberately untouched — they survive as Unfiled. */
export async function deleteTrip(id: string): Promise<void> {
  const { error } = await supabase
    .from('trips')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw toAppError(error)
}

export async function restoreTrip(id: string): Promise<void> {
  const { error } = await supabase.from('trips').update({ deleted_at: null }).eq('id', id)
  if (error) throw toAppError(error)
}
