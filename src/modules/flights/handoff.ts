/**
 * The arrival handoff. Spec 9.9 — the highest-value output in the module.
 *
 * One number, "leave at 19:10", is the thing the person on the ground actually
 * needs. Two rules make it trustworthy rather than a guess with a clock face:
 *
 *   1. Always show the breakdown. A bare time is unverifiable, so nobody can
 *      tell whether it accounted for baggage. The same figure with its parts
 *      is something you can argue with, which is what makes it usable.
 *   2. Void it loudly on a diversion. A confidently wrong airport run is the
 *      worst failure this module can produce.
 */
import { haversineKm, type LatLng } from '@/lib/utils'
import { SCHENGEN_MEMBERS } from '@/lib/zones'
import type { AirportWaitTime, FlightState, HandoffPlan, Phase } from './types'

/** Off the aircraft and into the terminal. */
const DISEMBARK_MINUTES = 15
/** Arrivals hall to the kerb. */
const WALK_MINUTES = 10
/** Slack, because nobody wants to arrive exactly on time to a pickup. */
const BUFFER_MINUTES = 15

/**
 * Immigration defaults in minutes, spec 9.9.
 *
 * Overridable per airport in `airport_wait_times`, which is where the real
 * numbers come from once the couple has measured a few — the payoff of
 * building this for two people rather than millions.
 */
export const IMMIGRATION_DEFAULTS = {
  domestic: 0,
  schengenInternal: 5,
  egate: 20,
  international: 45,
  busy: 60,
} as const

/** Airports where 45 minutes is optimistic. Overridden by measured data. */
const KNOWN_BUSY = new Set(['LHR', 'JFK', 'EWR', 'LAX', 'CDG', 'MIA', 'ORD', 'DEL', 'BOM'])

export const DEFAULT_BAGGAGE_MINUTES = 20
/** No routing API without a key, so: great circle × 1.4 at 45 km/h. */
export const DRIVE_DETOUR_FACTOR = 1.4
export const DRIVE_SPEED_KMH = 45

export interface HandoffInputs {
  /** Measured wait times for this airport, when someone has reported them. */
  waitTimes?: AirportWaitTime | null
  /** Where the watcher is driving from. */
  watcherHome?: LatLng | null
  originCountry?: string | null
  destCountry?: string | null
}

/**
 * When to leave, and why.
 *
 * Returns null when there is nobody waiting — spec 9.9 computes this "only
 * when a watcher exists", and both partners flying means neither is on the
 * ground to meet the other.
 */
export function computeHandoff(
  flight: FlightState,
  inputs: HandoffInputs = {},
): HandoffPlan | null {
  if (!flight.watcher) return null

  const landing = flight.times.actualArrival ?? flight.times.estimatedArrival ?? flight.times.scheduledArrival
  if (!landing) return null

  const immigration = immigrationMinutes(flight.dest.iata, inputs)
  const baggage = flight.hasCheckedBags
    ? (inputs.waitTimes?.baggage_minutes ?? DEFAULT_BAGGAGE_MINUTES)
    : 0

  const readyAt = addMinutes(landing, DISEMBARK_MINUTES + immigration + baggage + WALK_MINUTES)
  const drive = estimateDriveMinutes(inputs.watcherHome ?? null, {
    lat: flight.dest.lat,
    lng: flight.dest.lng,
  })

  const breakdown = {
    disembark: DISEMBARK_MINUTES,
    immigration,
    baggage,
    walk: WALK_MINUTES,
    drive,
    buffer: BUFFER_MINUTES,
  }

  return {
    leaveAt: addMinutes(readyAt, -(drive + BUFFER_MINUTES)),
    readyAt,
    // "Good" means the schedule behind it was refreshed recently. A plan built
    // on forty-minute-old data is a rough plan and says so.
    confidence:
      flight.freshness.status.ageSeconds !== null && flight.freshness.status.ageSeconds < 900
        ? 'good'
        : 'rough',
    voidReason: voidReasonFor(flight.phase),
    breakdown,
  }
}

function voidReasonFor(phase: Phase): string | null {
  if (phase === 'diverted') return 'Flight diverted — this plan is for the wrong airport.'
  if (phase === 'cancelled') return 'Flight cancelled.'
  return null
}

/**
 * How long immigration takes, measured first and guessed second.
 *
 * The guess reads the route: a domestic arrival has no immigration at all, one
 * Schengen country to another has almost none, and everything else is a
 * queue whose length depends on the airport.
 */
export function immigrationMinutes(iata: string | null, inputs: HandoffInputs): number {
  const measured = inputs.waitTimes?.immigration_minutes
  if (typeof measured === 'number') return measured

  const origin = inputs.originCountry?.toUpperCase() ?? null
  const dest = inputs.destCountry?.toUpperCase() ?? null

  if (origin && dest && origin === dest) return IMMIGRATION_DEFAULTS.domestic
  if (
    origin &&
    dest &&
    (SCHENGEN_MEMBERS as readonly string[]).includes(origin) &&
    (SCHENGEN_MEMBERS as readonly string[]).includes(dest)
  ) {
    return IMMIGRATION_DEFAULTS.schengenInternal
  }
  if (iata && KNOWN_BUSY.has(iata.toUpperCase())) return IMMIGRATION_DEFAULTS.busy
  return IMMIGRATION_DEFAULTS.international
}

/**
 * Drive time without a routing key.
 *
 * Great circle × 1.4 ÷ 45 km/h, and labelled an estimate wherever it is shown.
 * The 1.4 stands in for roads not being straight; 45 km/h for the mix of
 * motorway and city that an airport run usually is. Swap this one function if
 * a routing key ever appears.
 */
export function estimateDriveMinutes(
  from: LatLng | null,
  to: { lat: number | null; lng: number | null },
): number {
  if (!from || to.lat === null || to.lng === null) return 0
  const km = haversineKm(from, { lat: to.lat, lng: to.lng }) * DRIVE_DETOUR_FACTOR
  return Math.round((km / DRIVE_SPEED_KMH) * 60)
}

export function addMinutes(instant: string, minutes: number): string {
  return new Date(new Date(instant).getTime() + minutes * 60_000).toISOString()
}

/**
 * What the breakdown reads as, in order, skipping the parts that are zero.
 *
 * A domestic arrival with hand luggage should not show "immigration 0 min,
 * baggage 0 min" — those lines make the estimate look padded when it is
 * actually just short.
 */
export function describeBreakdown(plan: HandoffPlan): { label: string; minutes: number }[] {
  const { breakdown } = plan
  return [
    { label: 'Off the plane', minutes: breakdown.disembark },
    { label: 'Immigration', minutes: breakdown.immigration },
    { label: 'Baggage', minutes: breakdown.baggage },
    { label: 'To the door', minutes: breakdown.walk },
    { label: 'Drive', minutes: breakdown.drive },
    { label: 'Buffer', minutes: breakdown.buffer },
  ].filter((part) => part.minutes > 0)
}
