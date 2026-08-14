import type { Tables } from '@/types/database'
import type { PersonRef } from '@/types/domain'

export type FlightRow = Tables<'flights'>
export type FlightPosition = Tables<'flight_positions'>
export type FlightEvent = Tables<'flight_events'>
export type Journey = Tables<'journeys'>
export type AirlineCode = Tables<'airline_codes'>
export type AirportWaitTime = Tables<'airport_wait_times'>

export type Phase =
  | 'scheduled'
  | 'checkin'
  | 'boarding'
  | 'departed'
  | 'enroute'
  | 'descending'
  | 'landed'
  | 'cancelled'
  | 'diverted'
  | 'unknown'

export type PositionConfidence = 'live' | 'stale' | 'estimated' | 'none'

export type StatusSource = 'aerodatabox' | 'cache' | 'manual'
export type PositionSource = 'opensky' | 'cache' | 'interpolated'

export interface FlightTimes {
  scheduledDeparture: string | null
  estimatedDeparture: string | null
  actualDeparture: string | null
  scheduledArrival: string | null
  estimatedArrival: string | null
  actualArrival: string | null
  /** Signed. Negative means early. */
  delayMinutes: number
}

export interface Airport {
  iata: string | null
  name: string | null
  tz: string | null
  lat: number | null
  lng: number | null
  terminal?: string | null
  gate?: string | null
  belt?: string | null
}

export interface PositionState {
  lat: number
  lng: number
  altitudeM: number | null
  headingDeg: number | null
  velocityMs: number | null
  verticalRateMs: number | null
  onGround: boolean
  confidence: PositionConfidence
  recordedAt: string
  ageSeconds: number
}

export interface Progress {
  fraction: number
  distanceFlownKm: number
  distanceRemainingKm: number
  minutesRemaining: number | null
  /** Which basis was used. A position-derived ETA is materially better. */
  source: 'position' | 'time'
}

export interface Freshness {
  status: { source: StatusSource; ageSeconds: number | null }
  position: { source: PositionSource; ageSeconds: number | null }
  degraded: boolean
  /** Human-readable, rendered as quiet notes rather than errors. */
  notices: string[]
  /** 1–7 on the spec's ladder. Useful in tests; not shown to users. */
  level: number
}

export interface HandoffBreakdown {
  disembark: number
  immigration: number
  baggage: number
  walk: number
  drive: number
  buffer: number
}

export interface HandoffPlan {
  leaveAt: string
  readyAt: string
  breakdown: HandoffBreakdown
  confidence: 'good' | 'rough'
  /** Set when the plan must not be trusted — a diversion voids it loudly. */
  voidReason: string | null
}

/**
 * Everything a screen renders, from one object.
 *
 * Spec 9.2's rule: a screen never sees a raw API response and never reconciles
 * two sources itself. If a component needs to know something about a flight,
 * it comes from here.
 */
export interface FlightState {
  id: string
  flightNumber: string
  callsign: string | null
  icao24: string | null
  registration: string | null
  airline: { iata: string | null; name: string | null }
  travelerId: string
  traveler: PersonRef | null
  /** The partner on the ground, when there is one. */
  watcher: PersonRef | null
  phase: Phase
  times: FlightTimes
  origin: Airport
  dest: Airport
  position: PositionState | null
  progress: Progress
  freshness: Freshness
  handoff: HandoffPlan | null
  trackingActive: boolean
  hasCheckedBags: boolean
}

export type ConnectionRisk = 'ok' | 'tight' | 'high'

export interface Connection {
  fromFlightId: string
  toFlightId: string
  bufferMinutes: number
  minimumMinutes: number
  risk: ConnectionRisk
  sameTerminal: boolean
}

/** What the confirmation-text parser managed to pull out. */
export interface ParsedFlight {
  flightNumber: string
  date: string | null
  originIata: string | null
  destIata: string | null
  bookingRef: string | null
}
