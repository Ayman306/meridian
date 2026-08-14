/** Module 9 — Flights. Supabase access, plus the two Route Handlers. */
'use client'

import { supabase } from '@/lib/supabase/client'
import { toAppError, unwrap, unwrapList, unwrapMaybe } from '@/lib/errors'
import type { InsertDto, UpdateDto } from '@/types/database'
import { normaliseFlightNumber } from './logic'
import type { AirportRow, AirportWaitTime, FlightPosition, FlightRow, Journey } from './types'

export async function listFlights(coupleId: string): Promise<FlightRow[]> {
  return unwrapList(
    await supabase
      .from('flights')
      .select('*')
      .eq('couple_id', coupleId)
      .is('deleted_at', null)
      .order('scheduled_departure', { ascending: true, nullsFirst: false }),
  )
}

export async function getFlight(id: string): Promise<FlightRow> {
  return unwrap(await supabase.from('flights').select('*').eq('id', id).single())
}

/** The breadcrumb trail, oldest first — that is the order a polyline wants. */
export async function getFlightTrack(id: string): Promise<FlightPosition[]> {
  return unwrapList(
    await supabase
      .from('flight_positions')
      .select('*')
      .eq('flight_id', id)
      .order('recorded_at', { ascending: true })
      .limit(500),
  )
}

export async function latestPositions(flightIds: readonly string[]): Promise<FlightPosition[]> {
  if (flightIds.length === 0) return []
  const rows = unwrapList(
    await supabase
      .from('flight_positions')
      .select('*')
      .in('flight_id', [...flightIds])
      .order('recorded_at', { ascending: false })
      .limit(200),
  )

  // One per flight, newest kept.
  const seen = new Set<string>()
  return rows.filter((row) => {
    if (seen.has(row.flight_id)) return false
    seen.add(row.flight_id)
    return true
  })
}

export type FlightInput = Omit<InsertDto<'flights'>, 'couple_id' | 'id'>

export async function addFlight(coupleId: string, input: FlightInput): Promise<FlightRow> {
  return unwrap(
    await supabase
      .from('flights')
      .insert({
        ...input,
        couple_id: coupleId,
        flight_number: normaliseFlightNumber(input.flight_number),
      })
      .select('*')
      .single(),
  )
}

export async function updateFlight(id: string, patch: UpdateDto<'flights'>): Promise<FlightRow> {
  return unwrap(await supabase.from('flights').update(patch).eq('id', id).select('*').single())
}

/**
 * Whatever the user typed wins, forever.
 *
 * Merged rather than replaced so correcting the gate does not silently drop a
 * time they fixed last week.
 */
export async function setManualOverride(
  id: string,
  override: Record<string, unknown>,
): Promise<FlightRow> {
  const current = await getFlight(id)
  const existing =
    current.manual_override && typeof current.manual_override === 'object'
      ? (current.manual_override as Record<string, unknown>)
      : {}

  return updateFlight(id, { manual_override: { ...existing, ...override } as never })
}

export async function stopTracking(id: string): Promise<FlightRow> {
  return updateFlight(id, { tracking_active: false })
}

export async function deleteFlight(id: string): Promise<void> {
  const { error } = await supabase
    .from('flights')
    .update({ deleted_at: new Date().toISOString(), tracking_active: false })
    .eq('id', id)
  if (error) throw toAppError(error)
}

export async function addJourney(
  coupleId: string,
  tripId: string | null,
  travelerId: string,
  direction: 'outbound' | 'return',
  bookingRef?: string | null,
): Promise<Journey> {
  return unwrap(
    await supabase
      .from('journeys')
      .insert({
        couple_id: coupleId,
        trip_id: tripId,
        traveler_id: travelerId,
        direction,
        booking_ref: bookingRef ?? null,
      })
      .select('*')
      .single(),
  )
}

export async function listJourneys(): Promise<Journey[]> {
  return unwrapList(
    await supabase.from('journeys').select('*').order('created_at', { ascending: true }),
  )
}

/**
 * Delete a journey and every leg on it.
 *
 * The flights cascade in the database (`journey_id ... on delete cascade`), but
 * they are soft-deleted here first so a mistaken delete is as recoverable as
 * any other flight. The journey row itself is small and carries nothing worth
 * keeping once its legs are gone.
 */
export async function deleteJourney(journeyId: string): Promise<void> {
  const stamp = new Date().toISOString()
  const { error: flightError } = await supabase
    .from('flights')
    .update({ deleted_at: stamp, tracking_active: false })
    .eq('journey_id', journeyId)
  if (flightError) throw toAppError(flightError)

  const { error } = await supabase.from('journeys').delete().eq('id', journeyId)
  if (error) throw toAppError(error)
}

// ---------------------------------------------------------------------------
// Route Handlers
// ---------------------------------------------------------------------------

export interface LookupResult {
  resolved: boolean
  flightNumber: string
  callsign: string | null
  registration?: string | null
  aircraftType?: string | null
  airlineIata: string | null
  airlineName: string | null
  originIata?: string | null
  originName?: string | null
  originTz?: string | null
  destIata?: string | null
  destName?: string | null
  destTz?: string | null
  scheduledDeparture?: string | null
  scheduledArrival?: string | null
  estimatedDeparture?: string | null
  estimatedArrival?: string | null
  gate?: string | null
  terminal?: string | null
  notice?: string | null
}

export async function lookupFlight(
  flightNumber: string,
  date: string,
): Promise<LookupResult | null> {
  try {
    const res = await fetch('/api/flights/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flightNumber, date }),
    })
    if (!res.ok) return null
    return (await res.json()) as LookupResult
  } catch {
    // Manual entry is the baseline. A failed lookup is not an error worth
    // showing — the form still works.
    return null
  }
}

export interface StatusResponse {
  flights: FlightRow[]
  positions: FlightPosition[]
  notices: string[]
}

/**
 * The 60-second tick.
 *
 * Sends every visible flight at once so the server can batch its decisions;
 * whether anything is actually fetched is the server's call, never this one's.
 */
export async function refreshFlights(flightIds: readonly string[]): Promise<StatusResponse> {
  if (flightIds.length === 0) return { flights: [], positions: [], notices: [] }

  const res = await fetch('/api/flights/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ flightIds }),
  })

  if (!res.ok) return { flights: [], positions: [], notices: [] }
  return (await res.json()) as StatusResponse
}

// ---------------------------------------------------------------------------
// Wait times — the part that gets better with use
// ---------------------------------------------------------------------------

export async function getWaitTimes(iata: string | null): Promise<AirportWaitTime | null> {
  if (!iata) return null
  const { data } = await supabase
    .from('airport_wait_times')
    .select('*')
    .eq('iata', iata.toUpperCase())
    .maybeSingle()
  return data ?? null
}

/**
 * "How long did she actually take?" — one tap after an arrival.
 *
 * Writes back to the shared table, so the next estimate for that airport is
 * measured rather than guessed. This is the payoff of building for two people
 * rather than millions: the sample size is small but it is *your* sample.
 */
export async function reportActualWait(
  iata: string,
  userId: string,
  minutes: { immigration?: number; baggage?: number },
): Promise<void> {
  const existing = await getWaitTimes(iata)

  const { error } = await supabase.from('airport_wait_times').upsert(
    {
      iata: iata.toUpperCase(),
      immigration_minutes: minutes.immigration ?? existing?.immigration_minutes ?? null,
      baggage_minutes: minutes.baggage ?? existing?.baggage_minutes ?? null,
      notes: existing?.notes ?? null,
      updated_by: userId,
    },
    { onConflict: 'iata' },
  )
  if (error) throw toAppError(error)
}

export async function getQuotaUsage(): Promise<{ aerodatabox: number; opensky: number }> {
  const [adb, osky] = await Promise.all([
    supabase.rpc('api_usage_in_window', { target_provider: 'aerodatabox' }),
    supabase.rpc('api_usage_in_window', { target_provider: 'opensky' }),
  ])
  return { aerodatabox: adb.data ?? 0, opensky: osky.data ?? 0 }
}

/**
 * Airport search for the picker.
 *
 * An exact IATA match always sorts first: typing "DXB" must not rank Dubai
 * below something whose *name* happens to contain those letters. Everything
 * else matches on code, city or name, because people think in all three.
 */
export async function searchAirports(query: string): Promise<AirportRow[]> {
  const q = query.trim()
  if (!q) return []

  const rows = unwrapList(
    await supabase
      .from('airports')
      .select('*')
      .or(`iata.ilike.%${q}%,city.ilike.%${q}%,name.ilike.%${q}%`)
      .limit(20),
  )

  const upper = q.toUpperCase()
  return rows.sort((a, b) => {
    const aExact = a.iata === upper ? 0 : 1
    const bExact = b.iata === upper ? 0 : 1
    return aExact - bExact || a.city.localeCompare(b.city)
  })
}

/** One airport by code, for filling a flight's route columns. */
export async function getAirport(iata: string): Promise<AirportRow | null> {
  return unwrapMaybe(
    await supabase.from('airports').select('*').eq('iata', iata.toUpperCase()).maybeSingle(),
  )
}

// ---------------------------------------------------------------------------
// Saving a whole booking
// ---------------------------------------------------------------------------

export interface LegInput {
  legIndex: number
  flightNumber: string
  flightDate: string
  originIata: string | null
  originName: string | null
  originTz: string | null
  originLat: number | null
  originLng: number | null
  destIata: string | null
  destName: string | null
  destTz: string | null
  destLat: number | null
  destLng: number | null
  scheduledDeparture: string | null
  scheduledArrival: string | null
}

export interface JourneyInput {
  tripId: string | null
  travelerId: string
  bookingRef: string | null
  hasCheckedBags: boolean
  outbound: LegInput[]
  return?: LegInput[]
}

/**
 * Save a booking: one journey per direction, and its legs beneath it.
 *
 * The two directions are separate journeys sharing a booking reference, which
 * is what they are — you can be delayed on the way out without that meaning
 * anything about the way home, and each has its own connections.
 *
 * Not a transaction, because Supabase's client cannot open one. The inserts are
 * ordered so a partial failure leaves something coherent rather than orphaned:
 * the journey row first, then its legs. A journey with no legs is visible and
 * deletable; a leg pointing at a journey that does not exist would not be.
 */
export async function saveJourney(coupleId: string, input: JourneyInput): Promise<void> {
  const write = async (direction: 'outbound' | 'return', legs: LegInput[]) => {
    const journey = await addJourney(
      coupleId,
      input.tripId,
      input.travelerId,
      direction,
      input.bookingRef,
    )

    const rows = legs.map((leg) => ({
      couple_id: coupleId,
      journey_id: journey.id,
      trip_id: input.tripId,
      traveler_id: input.travelerId,
      leg_index: leg.legIndex,
      flight_number: leg.flightNumber,
      flight_date: leg.flightDate,
      has_checked_bags: input.hasCheckedBags,
      origin_iata: leg.originIata,
      origin_name: leg.originName,
      origin_tz: leg.originTz,
      origin_lat: leg.originLat,
      origin_lng: leg.originLng,
      dest_iata: leg.destIata,
      dest_name: leg.destName,
      dest_tz: leg.destTz,
      dest_lat: leg.destLat,
      dest_lng: leg.destLng,
      scheduled_departure: leg.scheduledDeparture,
      scheduled_arrival: leg.scheduledArrival,
      // Untimed is a real state and the phase says so, rather than claiming a
      // schedule nobody supplied.
      phase: leg.scheduledDeparture ? 'scheduled' : 'unknown',
    }))

    const { error } = await supabase.from('flights').insert(rows)
    if (error) throw toAppError(error)
  }

  await write('outbound', input.outbound)
  if (input.return && input.return.length > 0) await write('return', input.return)
}

/**
 * What the provider says is left, as last read by the server.
 *
 * Read-only here: the row is written by the Route Handlers under the service
 * role. A null `remaining` means it has never been established, which the UI
 * says rather than showing a zero.
 */
export async function getProviderBalance(): Promise<{
  remaining: number | null
  total: number | null
  checkedAt: string | null
} | null> {
  const row = unwrapMaybe(
    await supabase
      .from('provider_quota')
      .select('remaining, total, checked_at')
      .eq('provider', 'aerodatabox')
      .maybeSingle(),
  )
  return row
    ? { remaining: row.remaining, total: row.total, checkedAt: row.checked_at }
    : null
}
