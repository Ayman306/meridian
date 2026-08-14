/** Module 9 — Flights. Supabase access, plus the two Route Handlers. */
'use client'

import { supabase } from '@/lib/supabase/client'
import { toAppError, unwrap, unwrapList } from '@/lib/errors'
import type { InsertDto, UpdateDto } from '@/types/database'
import { normaliseFlightNumber } from './logic'
import type { AirportWaitTime, FlightPosition, FlightRow, Journey } from './types'

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
): Promise<Journey> {
  return unwrap(
    await supabase
      .from('journeys')
      .insert({ couple_id: coupleId, trip_id: tripId, traveler_id: travelerId, direction })
      .select('*')
      .single(),
  )
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
