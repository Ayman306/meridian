/**
 * The orchestrator. Spec 9.4.
 *
 * One entry point that decides — per flight, per source, independently —
 * whether a call is allowed to happen, makes the ones that are, persists what
 * comes back, and returns reconciled state. Shared by the on-demand Route
 * Handler and the background sweep so the two cannot drift apart on the rules
 * that keep the budget intact.
 *
 * **Isolation is the core robustness property.** OpenSky failing must not stop
 * a status update and vice versa, so each source is settled separately and a
 * failure degrades one field group with a notice rather than failing anything.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { FlightPosition, FlightRow, Phase } from '@/modules/flights/types'
import {
  computePhase,
  minutesBetween,
  needsRefresh,
  positionMaxAgeSeconds,
  statusMaxAgeSeconds,
  toCallsign,
} from '@/modules/flights/logic'
import {
  aerodataboxConfigured,
  fetchPosition,
  fetchStatus,
  mapProviderStatus,
  openskyConfigured,
  withQuota,
} from './providers'

type Client = SupabaseClient<Database>

export interface RefreshOutcome {
  flight: FlightRow
  position: FlightPosition | null
  notices: string[]
  quotaExhausted: boolean
  /** What actually went out. Used by the tests that assert the call budget. */
  calls: { status: boolean; position: boolean }
}

/**
 * Bring one flight up to date, spending at most one unit per provider.
 *
 * `force` is the manual refresh button. It skips the client's own cooldown but
 * **not** the max-age check — spec 9.14 requires that spamming refresh twenty
 * times produces at most one call, and the only way to guarantee that is for
 * the server to apply the same rule either way.
 */
export async function refreshFlight(
  admin: Client,
  flight: FlightRow,
  now = new Date(),
): Promise<RefreshOutcome> {
  const notices: string[] = []
  let quotaExhausted = false

  const position = await latestPosition(admin, flight.id)
  const phase = computePhase(flight, position, now)

  const toDeparture = instantOr(flight.estimated_departure, flight.scheduled_departure, now)
  const toArrival = instantOr(flight.estimated_arrival, flight.scheduled_arrival, now)

  // A flight nobody is tracking any more costs nothing, whatever the UI does.
  const active = flight.tracking_active && !flight.deleted_at

  const wantStatus =
    active && needsRefresh(flight.status_polled_at, statusMaxAgeSeconds(phase, toDeparture, toArrival), now)

  const wantPosition =
    active && needsRefresh(flight.position_polled_at, positionMaxAgeSeconds(phase), now)

  const callsign = flight.callsign ?? toCallsign(flight.flight_number, null)

  // Both settled together and neither able to reject: this is the isolation
  // property, and it is why the shape below is `allSettled` over two promises
  // that already swallow their own failures.
  const [statusOutcome, positionOutcome] = await Promise.allSettled([
    wantStatus && aerodataboxConfigured()
      ? withQuota(admin, 'aerodatabox', flight.id, () =>
          fetchStatus(flight.flight_number, flight.flight_date),
        )
      : Promise.resolve(null),
    wantPosition && openskyConfigured() && (callsign || flight.icao24)
      ? withQuota(admin, 'opensky', flight.id, () => fetchPosition(callsign, flight.icao24))
      : Promise.resolve(null),
  ])

  let next: Partial<FlightRow> = {}
  const calls = { status: false, position: false }

  if (statusOutcome.status === 'fulfilled' && statusOutcome.value) {
    const result = statusOutcome.value
    calls.status = result.ok
    if (result.quota) quotaExhausted = true
    if (result.reason) notices.push(result.reason)

    if (result.ok && result.data) {
      const s = result.data
      next = {
        ...next,
        callsign: s.callsign ?? flight.callsign,
        registration: s.registration ?? flight.registration,
        aircraft_type: s.aircraftType ?? flight.aircraft_type,
        airline_iata: s.airlineIata ?? flight.airline_iata,
        airline_name: s.airlineName ?? flight.airline_name,
        origin_iata: s.originIata ?? flight.origin_iata,
        origin_name: s.originName ?? flight.origin_name,
        origin_tz: s.originTz ?? flight.origin_tz,
        dest_iata: s.destIata ?? flight.dest_iata,
        dest_name: s.destName ?? flight.dest_name,
        dest_tz: s.destTz ?? flight.dest_tz,
        scheduled_departure: s.scheduledDeparture ?? flight.scheduled_departure,
        estimated_departure: s.estimatedDeparture ?? flight.estimated_departure,
        actual_departure: s.actualDeparture ?? flight.actual_departure,
        scheduled_arrival: s.scheduledArrival ?? flight.scheduled_arrival,
        estimated_arrival: s.estimatedArrival ?? flight.estimated_arrival,
        actual_arrival: s.actualArrival ?? flight.actual_arrival,
        gate: s.gate ?? flight.gate,
        terminal: s.terminal ?? flight.terminal,
        baggage_belt: s.baggageBelt ?? flight.baggage_belt,
        raw_status: s.raw as never,
        status_polled_at: now.toISOString(),
        status_error_count: 0,
      }

      const mapped = mapProviderStatus(s.status)
      if (mapped) next.phase = mapped
    } else if (!result.quota) {
      next.status_error_count = flight.status_error_count + 1
    }
  }

  let newPosition = position

  if (positionOutcome.status === 'fulfilled' && positionOutcome.value) {
    const result = positionOutcome.value
    calls.position = result.ok
    if (result.quota) quotaExhausted = true
    if (result.reason) notices.push(result.reason)

    if (result.ok && result.data) {
      const p = result.data
      const { data: inserted } = await admin
        .from('flight_positions')
        .insert({
          flight_id: flight.id,
          lat: p.lat,
          lng: p.lng,
          altitude_m: p.altitudeM,
          heading: p.heading,
          velocity_ms: p.velocityMs,
          vertical_rate: p.verticalRate,
          on_ground: p.onGround,
          source: 'opensky',
          recorded_at: p.recordedAt,
        })
        .select('*')
        .single()

      if (inserted) newPosition = inserted
      next.position_polled_at = now.toISOString()
      next.position_error_count = 0
      // Learned once, passed directly on every later poll — a lookup by hex is
      // cheaper and cannot match a recycled callsign.
      if (!flight.icao24 && p.icao24) next.icao24 = p.icao24
    } else if (!result.quota) {
      next.position_error_count = flight.position_error_count + 1
    }
  }

  const merged: FlightRow = { ...flight, ...next }
  const settledPhase = computePhase(merged, newPosition, now)
  const withPhase: FlightRow = { ...merged, phase: settledPhase }

  // The hard stop, applied the moment it becomes true rather than waiting for
  // the nightly sweep to notice.
  const stopTracking =
    settledPhase === 'landed' ||
    settledPhase === 'cancelled' ||
    Boolean(withPhase.actual_arrival) ||
    withPhase.status_error_count > 10

  const patch: Partial<FlightRow> = {
    ...next,
    phase: settledPhase,
    ...(stopTracking ? { tracking_active: false } : {}),
  }

  if (Object.keys(patch).length > 0 && hasChanges(flight, patch)) {
    await admin.from('flights').update(patch).eq('id', flight.id)
    await recordPhaseChange(admin, flight, settledPhase)
  }

  return {
    flight: { ...withPhase, ...(stopTracking ? { tracking_active: false } : {}) },
    position: newPosition,
    notices,
    quotaExhausted,
    calls,
  }
}

/** A phase change is what a notification is eventually built from (spec 9.8). */
async function recordPhaseChange(admin: Client, before: FlightRow, after: Phase) {
  if (before.phase === after) return
  await admin.from('flight_events').insert({
    flight_id: before.id,
    event_type: 'phase_change',
    from_value: { phase: before.phase } as never,
    to_value: { phase: after } as never,
  })
}

function hasChanges(flight: FlightRow, patch: Partial<FlightRow>): boolean {
  return Object.entries(patch).some(
    ([key, value]) => (flight as unknown as Record<string, unknown>)[key] !== value,
  )
}

export async function latestPosition(admin: Client, flightId: string): Promise<FlightPosition | null> {
  const { data } = await admin
    .from('flight_positions')
    .select('*')
    .eq('flight_id', flightId)
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data ?? null
}

function instantOr(a: string | null, b: string | null, now: Date): number | null {
  const value = a ?? b
  return value ? minutesBetween(now, value) : null
}
