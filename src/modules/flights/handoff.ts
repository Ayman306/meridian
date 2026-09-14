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
/** No routing API without a key, so: great circle × 1.4 at the speeds below. */
export const DRIVE_DETOUR_FACTOR = 1.4
/** Town driving: the airport approach, traffic lights, the ring road. */
export const DRIVE_SPEED_KMH = 45
/** Motorway cruise, for the part of a long drive that is not town. */
export const DRIVE_SPEED_MOTORWAY_KMH = 90
/** How much of any drive is treated as town at each end. */
export const DRIVE_TOWN_KM = 30

/**
 * Past this far apart, nobody is collecting anybody.
 *
 * Measured as straight-line distance rather than estimated minutes, so the cut
 * does not move when the speed model is tuned. 400 km covers any pickup
 * somebody would really make — Porto to Lisbon, Manchester to Heathrow — and
 * excludes the case this exists for: a watcher on another continent.
 *
 * Without the cut, `estimateDriveMinutes` answered every distance. It ran the
 * 11,000 km from a watcher's home to DXB through a car and produced "Drive
 * 20666 min" — a fortnight at the wheel, presented on the pickup card as a
 * plan, with a departure time worked back from it.
 *
 * That is not an edge case here. Two people in different countries is the
 * premise of the app, so the watcher is usually nowhere near the arrival
 * airport and the honest answer is that there is no pickup to plan.
 */
export const MAX_PICKUP_KM = 400

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
 * ground to meet the other — and also when the watcher is too far away to
 * drive, which for a long-distance couple is most of the time.
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

  // A pickup nobody could make is worse than no pickup card: it puts a precise
  // departure time against a drive across an ocean. The distance is still
  // worth showing — see `travelTimes` — just not as a plan.
  const apart = distanceBetween(inputs.watcherHome ?? null, {
    lat: flight.dest.lat,
    lng: flight.dest.lng,
  })
  if (apart !== null && apart > MAX_PICKUP_KM) return null

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
 * Great circle × 1.4, then the first 30 km at town speed and the rest at
 * motorway speed. The 1.4 stands in for roads not being straight.
 *
 * A single 45 km/h average was right for the airport run it was written for
 * and badly wrong for anything longer: it turned the 275 km from Porto to
 * Lisbon — three hours on the A1 — into eight and a half, which was enough to
 * make a real pickup look impossible. Splitting the drive is still a guess,
 * but it is the right shape: the slow part of a long drive is the two ends,
 * not the middle.
 *
 * Swap this one function if a routing key ever appears.
 */
export function estimateDriveMinutes(
  from: LatLng | null,
  to: { lat: number | null; lng: number | null },
): number {
  if (!from || to.lat === null || to.lng === null) return 0
  return driveMinutesForKm(haversineKm(from, { lat: to.lat, lng: to.lng }))
}

/** Shared with `travelTimes`, so the two never disagree about a car. */
function driveMinutesForKm(straightLineKm: number): number {
  const km = straightLineKm * DRIVE_DETOUR_FACTOR
  const town = Math.min(km, DRIVE_TOWN_KM)
  const motorway = Math.max(0, km - DRIVE_TOWN_KM)
  const hours = town / DRIVE_SPEED_KMH + motorway / DRIVE_SPEED_MOTORWAY_KMH
  return Math.round(hours * 60)
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

// ---------------------------------------------------------------------------
// How far apart, in units that mean something
// ---------------------------------------------------------------------------

/**
 * Rough speeds, for the "how long would it take" answers.
 *
 * A plane goes roughly straight and the rest follow roads, which is why only
 * the ground modes carry the detour factor. None of this is precise and none
 * of it needs to be — it is here to make a distance legible, not to plan a
 * journey.
 */
export const MODE_SPEEDS_KMH = {
  plane: 800,
  car: DRIVE_SPEED_KMH,
  bike: 15,
  walk: 5,
} as const

export type TravelMode = keyof typeof MODE_SPEEDS_KMH

export interface TravelEstimate {
  mode: TravelMode
  label: string
  minutes: number
}

const MODE_LABELS: Record<TravelMode, string> = {
  plane: 'Flying',
  car: 'Driving',
  bike: 'Cycling',
  walk: 'Walking',
}

/**
 * How long this distance takes by each way of covering it.
 *
 * Shown when there is no pickup to plan, which is when the interesting fact
 * about the two of you is the distance itself rather than a departure time.
 * A long-distance couple already knows they are far apart; this says how far
 * in terms anybody can picture.
 */
export function travelTimes(km: number): TravelEstimate[] {
  if (!Number.isFinite(km) || km <= 0) return []
  return (Object.keys(MODE_SPEEDS_KMH) as TravelMode[]).map((mode) => {
    // The car goes through the same town-then-motorway split the pickup
    // estimate uses, so the two can never quote different numbers.
    if (mode === 'car') return { mode, label: MODE_LABELS[mode], minutes: driveMinutesForKm(km) }
    const distance = mode === 'plane' ? km : km * DRIVE_DETOUR_FACTOR
    return {
      mode,
      label: MODE_LABELS[mode],
      minutes: Math.round((distance / MODE_SPEEDS_KMH[mode]) * 60),
    }
  })
}

/** The great-circle distance between two points, or null without both. */
export function distanceBetween(
  from: LatLng | null,
  to: { lat: number | null; lng: number | null },
): number | null {
  if (!from || to.lat === null || to.lng === null) return null
  return haversineKm(from, { lat: to.lat, lng: to.lng })
}
