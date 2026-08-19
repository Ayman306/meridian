/**
 * Pure functions for Module 9 — Flights.
 *
 * Three things live here and nothing else does: the phase machine, the
 * reconciliation rules for when the two providers disagree, and the arithmetic
 * that turns rows into the single `FlightState` a screen renders.
 *
 * Everything is pure because all of it is load-bearing. The cache max-age
 * table decides whether the month's API allowance survives; the reconciliation
 * rules decide whether someone waiting at an airport is told the truth. Both
 * are testable, so both are tested.
 */
import { haversineKm, type LatLng } from '@/lib/utils'
import { crossTrackDistanceKm, interpolateGreatCircle } from '@/lib/geo'
import type {
  Connection,
  ConnectionRisk,
  FlightPosition,
  FlightRow,
  FlightState,
  FlightTimes,
  Freshness,
  Phase,
  PositionConfidence,
  PositionState,
  Progress,
} from './types'

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * 'AC 42', 'ac0042' and 'AC42' are the same flight. Spec 9.14 says so.
 *
 * Two-character prefixes can contain a digit ('6E', 'U2'), so the split is on
 * the first run of letters-and-digits followed by digits, not on "two letters".
 */
export function normaliseFlightNumber(input: string): string {
  const cleaned = input.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const match = cleaned.match(/^([A-Z0-9]{2,3}?)0*(\d{1,4})$/)
  if (!match) return cleaned
  return `${match[1]}${match[2]}`
}

/** The airline prefix, or null when the number does not parse. */
export function airlineCode(flightNumber: string): string | null {
  return normaliseFlightNumber(flightNumber).match(/^([A-Z0-9]{2,3}?)\d{1,4}$/)?.[1] ?? null
}

/**
 * The callsign OpenSky knows, built from the ICAO airline code.
 *
 * 'AC42' plus ACA gives 'ACA42'. Without a row in `airline_codes` there is no
 * callsign, so position tracking is simply unavailable for that flight —
 * status still works (spec 9.13).
 */
export function toCallsign(flightNumber: string, icaoAirline: string | null): string | null {
  if (!icaoAirline) return null
  const digits = normaliseFlightNumber(flightNumber).match(/(\d{1,4})$/)?.[1]
  return digits ? `${icaoAirline.toUpperCase()}${digits}` : null
}

// ---------------------------------------------------------------------------
// Phase
// ---------------------------------------------------------------------------

/** Ground contact within this distance of the destination means landed. */
export const NEAR_AIRPORT_KM = 10
/** Cross-track deviation beyond this means the flight is not going there. */
export const DIVERSION_CORRIDOR_KM = 200

const MINUTE = 60_000

export function minutesBetween(from: string | Date, to: string | Date): number {
  return (new Date(to).getTime() - new Date(from).getTime()) / MINUTE
}

/**
 * The phase, from whatever is known. Spec 9.6, transcribed.
 *
 * Order matters and is not arbitrary: the manual override wins over
 * everything, a recorded arrival beats any estimate, and a diversion is
 * checked before the enroute cases so a flight heading somewhere else is never
 * described as being on its way.
 */
export function computePhase(
  flight: Pick<
    FlightRow,
    | 'phase'
    | 'gate'
    | 'actual_departure'
    | 'actual_arrival'
    | 'estimated_departure'
    | 'estimated_arrival'
    | 'scheduled_departure'
    | 'scheduled_arrival'
    | 'manual_override'
    | 'dest_lat'
    | 'dest_lng'
    | 'origin_lat'
    | 'origin_lng'
  >,
  position: FlightPosition | null,
  now: Date,
): Phase {
  const override = overridePhase(flight.manual_override)
  if (override) return override

  if (flight.phase === 'cancelled') return 'cancelled'

  const dest = coords(flight.dest_lat, flight.dest_lng)
  const at = position ? { lat: Number(position.lat), lng: Number(position.lng) } : null

  if (flight.actual_arrival) return 'landed'
  if (position?.on_ground && at && dest && haversineKm(at, dest) < NEAR_AIRPORT_KM) return 'landed'

  if (isDiverted(flight, position)) return 'diverted'

  const airborne = Boolean(position && !position.on_ground)
  const arrival = flight.estimated_arrival ?? flight.scheduled_arrival
  const departure = flight.estimated_departure ?? flight.scheduled_departure

  if (airborne || flight.actual_departure) {
    const toArrival = arrival ? minutesBetween(now, arrival) : null
    const descending = Number(position?.vertical_rate ?? 0) < -2
    if ((toArrival !== null && toArrival <= 60) || descending) return 'descending'
    if (flight.actual_departure && minutesBetween(flight.actual_departure, now) > 10) {
      return 'enroute'
    }
    // Airborne with no recorded departure time: it left, we just missed it.
    return flight.actual_departure ? 'departed' : 'enroute'
  }

  if (!departure) return 'unknown'
  const toDeparture = minutesBetween(now, departure)
  if (flight.gate && toDeparture <= 60) return 'boarding'
  if (toDeparture <= 180) return 'checkin'
  return 'scheduled'
}

/**
 * Off the corridor between origin and destination.
 *
 * Only meaningful once airborne and only with both endpoints known — an
 * aircraft still at the gate is trivially "off route" by a few hundred metres,
 * and a flight with no coordinates cannot be judged at all.
 */
export function isDiverted(
  flight: Pick<FlightRow, 'origin_lat' | 'origin_lng' | 'dest_lat' | 'dest_lng' | 'actual_departure'>,
  position: FlightPosition | null,
): boolean {
  if (!position || position.on_ground) return false
  const origin = coords(flight.origin_lat, flight.origin_lng)
  const dest = coords(flight.dest_lat, flight.dest_lng)
  if (!origin || !dest) return false

  const at = { lat: Number(position.lat), lng: Number(position.lng) }
  return crossTrackDistanceKm(at, origin, dest) > DIVERSION_CORRIDOR_KM
}

export const ACTIVE_PHASES: Phase[] = ['departed', 'enroute', 'descending', 'diverted']
export const FINISHED_PHASES: Phase[] = ['landed', 'cancelled']

export function isAirbornePhase(phase: Phase): boolean {
  return ACTIVE_PHASES.includes(phase)
}

export function isFinished(phase: Phase): boolean {
  return FINISHED_PHASES.includes(phase)
}

// ---------------------------------------------------------------------------
// Polling budget
// ---------------------------------------------------------------------------

/**
 * How stale AeroDataBox data may be before another call is allowed.
 *
 * Spec 9.4's table, and the single most important function for the module's
 * running cost: roughly 85 calls per flight against 600 a month. A shorter
 * max-age anywhere in this ladder is a direct bill.
 *
 * Returns null when no call should ever be made — a landed flight is finished,
 * and polling it is pure waste.
 */
export function statusMaxAgeSeconds(
  phase: Phase,
  minutesToDeparture: number | null,
  minutesToArrival: number | null,
): number | null {
  if (isFinished(phase)) return null

  if (isAirbornePhase(phase)) {
    // The final hour is when gate, belt and delay actually change, and when
    // someone is driving to the airport on the answer.
    if (minutesToArrival !== null && minutesToArrival <= 60) return 2 * 60
    return 15 * 60
  }

  if (minutesToDeparture === null) return 6 * 60 * 60
  if (minutesToDeparture > 48 * 60) return 24 * 60 * 60
  if (minutesToDeparture > 6 * 60) return 6 * 60 * 60
  if (minutesToDeparture > 60) return 30 * 60
  return 10 * 60
}

/** OpenSky is cheap; 60s while airborne and nothing otherwise (spec 9.4). */
export const POSITION_INTERVAL_SECONDS = 60

export function positionMaxAgeSeconds(phase: Phase): number | null {
  return isAirbornePhase(phase) ? POSITION_INTERVAL_SECONDS - 5 : null
}

export function needsRefresh(polledAt: string | null, maxAgeSeconds: number | null, now: Date) {
  if (maxAgeSeconds === null) return false
  if (!polledAt) return true
  return (now.getTime() - new Date(polledAt).getTime()) / 1000 > maxAgeSeconds
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

/**
 * Fold a position fix into the stored row before anything else reads it.
 *
 * Spec 9.5. The two providers will contradict each other, and the rules for
 * who wins are specific rather than general:
 *
 *   - Ground contact at the destination is a hard fact. ADS-B says the wheels
 *     are down; the airline is still reporting the gate. OpenSky wins, and
 *     this is the one case where it does.
 *   - Airborne contradicts a "scheduled" phase, so the flight left and nobody
 *     told us.
 *   - Off-corridor means diverted, whatever the schedule says.
 *
 * Returns a new row; the caller decides whether to persist it.
 */
export function reconcile(flight: FlightRow, position: FlightPosition | null): FlightRow {
  let next = { ...flight }
  const dest = coords(flight.dest_lat, flight.dest_lng)
  const at = position ? { lat: Number(position.lat), lng: Number(position.lng) } : null

  if (position?.on_ground && at && dest && haversineKm(at, dest) < NEAR_AIRPORT_KM) {
    next = {
      ...next,
      actual_arrival: next.actual_arrival ?? position.recorded_at,
      phase: 'landed',
    }
  } else if (position && !position.on_ground && next.phase === 'scheduled') {
    next = {
      ...next,
      actual_departure: next.actual_departure ?? position.recorded_at,
      phase: 'enroute',
    }
  }

  if (isDiverted(next, position) && isAirbornePhase(next.phase as Phase)) {
    next = { ...next, phase: 'diverted' }
  }

  return applyOverride(next)
}

/** The user is always right, and is applied last so nothing can undo them. */
export function applyOverride(flight: FlightRow): FlightRow {
  const override = flight.manual_override
  if (!override || typeof override !== 'object' || Array.isArray(override)) return flight

  const fields = override as Record<string, unknown>
  const next = { ...flight }
  const allowed = [
    'phase',
    'gate',
    'terminal',
    'baggage_belt',
    'estimated_departure',
    'estimated_arrival',
    'actual_departure',
    'actual_arrival',
    'scheduled_departure',
    'scheduled_arrival',
  ] as const

  for (const key of allowed) {
    const value = fields[key]
    if (value !== undefined && value !== null) {
      // The cast is unavoidable: the column types differ per key and the
      // override is jsonb. The allowlist above is what keeps it honest.
      ;(next as unknown as Record<string, unknown>)[key] = value
    }
  }

  return next
}

function overridePhase(override: FlightRow['manual_override']): Phase | null {
  if (!override || typeof override !== 'object' || Array.isArray(override)) return null
  const phase = (override as Record<string, unknown>).phase
  return typeof phase === 'string' ? (phase as Phase) : null
}

// ---------------------------------------------------------------------------
// Position and freshness
// ---------------------------------------------------------------------------

/** Older than this and the marker stops claiming to be live. */
export const LIVE_POSITION_SECONDS = 120
export const STALE_POSITION_SECONDS = 15 * 60

export function positionConfidence(ageSeconds: number | null): PositionConfidence {
  if (ageSeconds === null) return 'none'
  if (ageSeconds <= LIVE_POSITION_SECONDS) return 'live'
  if (ageSeconds <= STALE_POSITION_SECONDS) return 'stale'
  return 'estimated'
}

export function toPositionState(position: FlightPosition | null, now: Date): PositionState | null {
  if (!position) return null
  const ageSeconds = Math.max(0, (now.getTime() - new Date(position.recorded_at).getTime()) / 1000)

  return {
    lat: Number(position.lat),
    lng: Number(position.lng),
    altitudeM: position.altitude_m === null ? null : Number(position.altitude_m),
    headingDeg: position.heading === null ? null : Number(position.heading),
    velocityMs: position.velocity_ms === null ? null : Number(position.velocity_ms),
    verticalRateMs: position.vertical_rate === null ? null : Number(position.vertical_rate),
    onGround: position.on_ground,
    confidence: positionConfidence(ageSeconds),
    recordedAt: position.recorded_at,
    ageSeconds: Math.round(ageSeconds),
  }
}

/**
 * Where the data came from and how old it is. Spec 9.5's degradation ladder.
 *
 * The important property is that levels 3 and 6 are *normal*. A trans-Atlantic
 * flight spends hours out of radar coverage and a flight booked three weeks
 * out has nothing but a schedule, so the copy here says what is true without
 * sounding like something broke.
 */
export function computeFreshness(
  flight: FlightRow,
  position: PositionState | null,
  phase: Phase,
  now: Date,
  quotaExhausted = false,
): Freshness {
  const statusAge = flight.status_polled_at
    ? Math.round((now.getTime() - new Date(flight.status_polled_at).getTime()) / 1000)
    : null

  const statusSource = flight.manual_override
    ? 'manual'
    : statusAge !== null && statusAge < 15 * 60
      ? 'aerodatabox'
      : flight.status_polled_at
        ? 'cache'
        : 'manual'

  const positionSource =
    position === null
      ? 'interpolated'
      : position.confidence === 'live'
        ? 'opensky'
        : position.confidence === 'stale'
          ? 'cache'
          : 'interpolated'

  const notices: string[] = []
  let level = 1

  const statusFresh = statusAge !== null && statusAge < 30 * 60
  const airborne = isAirbornePhase(phase)

  if (position && position.confidence === 'stale') {
    notices.push(`Position last seen ${formatAge(position.ageSeconds)} ago.`)
    level = 2
  }

  if (airborne && (!position || position.confidence === 'estimated')) {
    // The mid-ocean case. Not a failure — most of a long-haul flight.
    notices.push('Estimated position — no radar coverage out here.')
    level = 3
  }

  if (!statusFresh && position?.confidence === 'live') {
    notices.push('Gate and terminal may be out of date.')
    level = 4
  }

  if (!statusFresh && statusAge !== null && !position) {
    notices.push(`Last updated ${formatAge(statusAge)} ago.`)
    level = 5
  }

  if (statusAge === null) {
    notices.push('Showing scheduled times.')
    level = 6
  }

  if (quotaExhausted) {
    notices.push('Live updates paused — the monthly data allowance is nearly used up.')
    level = 7
  }

  return {
    status: { source: statusSource, ageSeconds: statusAge },
    position: { source: positionSource, ageSeconds: position?.ageSeconds ?? null },
    degraded: level >= 3,
    notices,
    level,
  }
}

function formatAge(seconds: number): string {
  if (seconds < 90) return `${Math.round(seconds)} seconds`
  const minutes = Math.round(seconds / 60)
  if (minutes < 90) return `${minutes} min`
  return `${Math.round(minutes / 60)} hours`
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

/**
 * How far along, and — always reported — on what basis.
 *
 * A position-derived ETA is materially better than one read off a schedule,
 * and the person meeting the flight should be able to tell which they are
 * looking at (spec 9.7).
 */
export function computeProgress(
  flight: FlightRow,
  position: PositionState | null,
  phase: Phase,
  now: Date,
): Progress {
  const origin = coords(flight.origin_lat, flight.origin_lng)
  const dest = coords(flight.dest_lat, flight.dest_lng)
  const total = origin && dest ? haversineKm(origin, dest) : 0

  if (position && position.confidence !== 'estimated' && origin && dest && total > 0) {
    const flown = haversineKm(origin, { lat: position.lat, lng: position.lng })
    const remaining = Math.max(0, total - flown)
    const groundSpeedKmh = (position.velocityMs ?? 0) * 3.6

    return {
      fraction: clamp01(flown / total),
      distanceFlownKm: Math.round(flown),
      distanceRemainingKm: Math.round(remaining),
      minutesRemaining: groundSpeedKmh > 50 ? Math.round((remaining / groundSpeedKmh) * 60) : null,
      source: 'position',
    }
  }

  const start = flight.actual_departure ?? flight.scheduled_departure
  const end = flight.estimated_arrival ?? flight.scheduled_arrival
  const fraction =
    isFinished(phase) && phase === 'landed'
      ? 1
      : start && end
        ? clamp01(minutesBetween(start, now) / Math.max(1, minutesBetween(start, end)))
        : 0

  return {
    fraction,
    distanceFlownKm: Math.round(total * fraction),
    distanceRemainingKm: Math.round(total * (1 - fraction)),
    minutesRemaining: end ? Math.max(0, Math.round(minutesBetween(now, end))) : null,
    source: 'time',
  }
}

/**
 * Where the aircraft probably is when there is no fix.
 *
 * Along the great circle at the time-based fraction. Rendered hollow and
 * dashed, never in the same style as a real fix — spec 9.7 calls that the most
 * important rule in the map layer, and it is: the difference between informing
 * someone and lying to them while they drive to an airport.
 */
export function estimatedPosition(flight: FlightRow, fraction: number): LatLng | null {
  const origin = coords(flight.origin_lat, flight.origin_lng)
  const dest = coords(flight.dest_lat, flight.dest_lng)
  if (!origin || !dest) return null
  return interpolateGreatCircle(origin, dest, clamp01(fraction))
}

// ---------------------------------------------------------------------------
// Times
// ---------------------------------------------------------------------------

export function computeTimes(flight: FlightRow): FlightTimes {
  const scheduled = flight.scheduled_arrival
  const expected = flight.actual_arrival ?? flight.estimated_arrival

  return {
    scheduledDeparture: flight.scheduled_departure,
    estimatedDeparture: flight.estimated_departure,
    actualDeparture: flight.actual_departure,
    scheduledArrival: scheduled,
    estimatedArrival: flight.estimated_arrival,
    actualArrival: flight.actual_arrival,
    delayMinutes: scheduled && expected ? Math.round(minutesBetween(scheduled, expected)) : 0,
  }
}

/** When the flight is expected, best available. Drives the handoff. */
export function arrivalInstant(times: FlightTimes): string | null {
  return times.actualArrival ?? times.estimatedArrival ?? times.scheduledArrival
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

/**
 * Whether a connection holds. Spec 9.10.
 *
 * Surfaced the moment leg 1's delay is known, which is when it can still be
 * acted on — telling someone the connection was tight after they missed it is
 * not information.
 */
export function connectionRisk(
  leg1: Pick<FlightRow, 'id' | 'estimated_arrival' | 'scheduled_arrival' | 'terminal' | 'dest_iata'>,
  leg2: Pick<FlightRow, 'id' | 'scheduled_departure' | 'terminal' | 'origin_iata'>,
  isInternational = true,
): Connection | null {
  const arrival = leg1.estimated_arrival ?? leg1.scheduled_arrival
  if (!arrival || !leg2.scheduled_departure) return null

  const bufferMinutes = Math.round(minutesBetween(arrival, leg2.scheduled_departure))
  const sameTerminal = Boolean(leg1.terminal && leg2.terminal && leg1.terminal === leg2.terminal)
  const minimumMinutes = sameTerminal ? 45 : isInternational ? 90 : 60

  const risk: ConnectionRisk =
    bufferMinutes < minimumMinutes * 0.7 ? 'high' : bufferMinutes < minimumMinutes ? 'tight' : 'ok'

  return {
    fromFlightId: leg1.id,
    toFlightId: leg2.id,
    bufferMinutes,
    minimumMinutes,
    risk,
    sameTerminal,
  }
}

/**
 * Whether a connection crosses a border, which is what makes it slow.
 *
 * Immigration is the cost. You clear it on arriving from abroad, and you clear
 * exit formalities on leaving for abroad — so a connection is international if
 * *either* leg crosses a border, not only if both do. A domestic hop that feeds
 * a long-haul departure is still an international connection.
 *
 * `null` from `countryOf` means the airport is not in the reference table.
 * Unknown is treated as international, deliberately: the international minimum
 * is the longer one, and telling somebody they have plenty of time when they do
 * not is the failure that makes them miss a flight.
 */
export function isInternationalConnection(
  leg1: Pick<FlightRow, 'origin_iata' | 'dest_iata'>,
  leg2: Pick<FlightRow, 'origin_iata' | 'dest_iata'>,
  countryOf: (iata: string | null) => string | null,
): boolean {
  const hub = countryOf(leg1.dest_iata) ?? countryOf(leg2.origin_iata)
  const from = countryOf(leg1.origin_iata)
  const to = countryOf(leg2.dest_iata)
  if (!hub || !from || !to) return true
  return from !== hub || to !== hub
}

/**
 * Consecutive legs of one journey, in order.
 *
 * `countryOf` resolves an IATA code to a country so a domestic connection is
 * judged against the domestic minimum. Without it every connection is treated
 * as international — which is what happened before this parameter existed, and
 * meant a 70-minute hop between two domestic gates was flagged as tight when it
 * was comfortable.
 */
export function connectionsFor(
  flights: readonly FlightRow[],
  countryOf?: (iata: string | null) => string | null,
): Connection[] {
  const legs = [...flights].sort((a, b) => a.leg_index - b.leg_index)
  const out: Connection[] = []
  for (let i = 0; i < legs.length - 1; i++) {
    const leg1 = legs[i]!
    const leg2 = legs[i + 1]!
    const international = countryOf
      ? isInternationalConnection(leg1, leg2, countryOf)
      : true
    const connection = connectionRisk(leg1, leg2, international)
    if (connection) out.push(connection)
  }
  return out
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

export type FlightGroup = 'active' | 'upcoming' | 'past'

export function groupFlight(flight: FlightRow, phase: Phase, now: Date): FlightGroup {
  if (isAirbornePhase(phase) || phase === 'boarding' || phase === 'checkin') return 'active'
  if (isFinished(phase)) return 'past'
  const departure = flight.estimated_departure ?? flight.scheduled_departure
  if (departure && new Date(departure).getTime() < now.getTime()) return 'past'
  return 'upcoming'
}

export const GROUP_LABELS: Record<FlightGroup, string> = {
  active: 'Active now',
  upcoming: 'Upcoming',
  past: 'Past',
}

/**
 * Both partners flying to the same place. Spec 9.8.
 *
 * Nobody is waiting, so there is no handoff to compute; what matters instead
 * is the gap between the two arrivals — which is how long the first one sits
 * in an airport.
 */
export function bothFlying(states: readonly FlightState[]): {
  isBoth: boolean
  gapMinutes: number | null
} {
  const travelers = new Set(states.map((s) => s.travelerId))
  if (travelers.size < 2) return { isBoth: false, gapMinutes: null }

  const destinations = new Set(states.map((s) => s.dest.iata).filter(Boolean))
  if (destinations.size !== 1) return { isBoth: false, gapMinutes: null }

  const arrivals = states
    .map((s) => arrivalInstant(s.times))
    .filter((a): a is string => Boolean(a))
    .sort()

  if (arrivals.length < 2) return { isBoth: true, gapMinutes: null }
  return {
    isBoth: true,
    gapMinutes: Math.abs(Math.round(minutesBetween(arrivals[0]!, arrivals[arrivals.length - 1]!))),
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export function coords(lat: unknown, lng: unknown): LatLng | null {
  if (lat === null || lng === null || lat === undefined || lng === undefined) return null
  const parsed = { lat: Number(lat), lng: Number(lng) }
  return Number.isFinite(parsed.lat) && Number.isFinite(parsed.lng) ? parsed : null
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
}

export const PHASE_LABELS: Record<Phase, string> = {
  scheduled: 'Scheduled',
  checkin: 'Check-in open',
  boarding: 'Boarding',
  departed: 'Just departed',
  enroute: 'In the air',
  descending: 'Descending',
  landed: 'Landed',
  cancelled: 'Cancelled',
  diverted: 'Diverted',
  unknown: 'Unconfirmed',
}

// ---------------------------------------------------------------------------
// Journeys
// ---------------------------------------------------------------------------

/**
 * A journey is one direction of a booking: the legs that get you there, in
 * order. `DXB → BOM → IXE` is one journey with two legs; the trip home is a
 * second journey with `direction: 'return'` and usually the same booking
 * reference.
 *
 * Modelling it this way rather than as a flat list of flights is what makes
 * three things expressible at all: which legs connect (so a tight layover can
 * be warned about), what the journey's real endpoints are (`DXB → IXE`, not
 * whichever leg happens to sort first), and when somebody actually arrives.
 */
export interface JourneyLeg {
  flight: FlightRow
  /** The connection *into* this leg. Null on the first one. */
  connection: Connection | null
}

export interface JourneySummary {
  legs: JourneyLeg[]
  originIata: string | null
  destIata: string | null
  /** Airports changed at, in order. Empty on a direct flight. */
  stops: string[]
  departure: string | null
  arrival: string | null
  /** Door to door, including layovers. Null unless both ends are known. */
  totalMinutes: number | null
  /** The worst connection on the journey — what the card leads with. */
  worstRisk: ConnectionRisk | null
}

/**
 * Order the legs and work out where they connect.
 *
 * Sorted by `leg_index` rather than by time: a leg with no times yet still has
 * a position in the sequence, and a journey being entered leg by leg has to
 * render sensibly before any of them are timed.
 */
export function summariseJourney(flights: readonly FlightRow[]): JourneySummary {
  const legs = [...flights]
    .filter((f) => !f.deleted_at)
    .sort((a, b) => a.leg_index - b.leg_index)

  const withConnections: JourneyLeg[] = legs.map((flight, i) => {
    const previous = legs[i - 1]
    return {
      flight,
      // Always treated as international, which sets the 90-minute minimum.
      // The flight row carries no country, only an IATA code, so this cannot
      // be decided here — and of the two wrong answers, the one that warns
      // about a 70-minute domestic layover is much better than the one that
      // stays quiet about a 70-minute international one.
      connection: previous ? connectionRisk(previous, flight, true) : null,
    }
  })

  const first = legs[0] ?? null
  const last = legs[legs.length - 1] ?? null
  const departure = first?.scheduled_departure ?? null
  const arrival = last?.estimated_arrival ?? last?.scheduled_arrival ?? null

  const risks = withConnections
    .map((l) => l.connection?.risk)
    .filter((r): r is ConnectionRisk => r !== undefined)

  return {
    legs: withConnections,
    originIata: first?.origin_iata ?? null,
    destIata: last?.dest_iata ?? null,
    // Every airport you land at except the last one is a stop.
    stops: legs.slice(0, -1).map((l) => l.dest_iata).filter((c): c is string => Boolean(c)),
    departure,
    arrival,
    totalMinutes:
      departure && arrival ? Math.round(minutesBetween(departure, arrival)) : null,
    worstRisk: risks.includes('high') ? 'high' : risks.includes('tight') ? 'tight' : risks.length ? 'ok' : null,
  }
}

/** Where the journey reads as one line: "DXB → IXE, 1 stop". */
export function describeJourney(summary: JourneySummary): string {
  const route =
    summary.originIata && summary.destIata
      ? `${summary.originIata} → ${summary.destIata}`
      : 'Route not set'
  if (summary.stops.length === 0) return `${route} · direct`
  return `${route} · ${summary.stops.length} stop${summary.stops.length === 1 ? '' : 's'} (${summary.stops.join(', ')})`
}

/**
 * The next leg index to use when adding to a journey.
 *
 * Max plus one rather than length, so removing a middle leg and adding another
 * cannot produce a duplicate index.
 */
export function nextLegIndex(flights: readonly FlightRow[]): number {
  return flights.reduce((max, f) => Math.max(max, f.leg_index), 0) + 1
}
