/**
 * Rows in, `FlightState` out.
 *
 * The one place the assembly happens, so spec 9.2's rule holds: a screen never
 * reads two sources and reconciles them itself. Pure, and therefore tested
 * alongside the rest of the logic.
 */
import type { PersonRef } from '@/types/domain'
import type { AirportWaitTime, FlightPosition, FlightRow, FlightState } from './types'
import {
  computeFreshness,
  computePhase,
  computeProgress,
  computeTimes,
  reconcile,
  toPositionState,
} from './logic'
import { computeHandoff } from './handoff'

export interface BuildStateInput {
  flight: FlightRow
  position: FlightPosition | null
  people: { self: PersonRef | null; partner: PersonRef | null }
  waitTimes?: AirportWaitTime | null
  watcherHome?: { lat: number; lng: number } | null
  /** True when both partners are on flights to the same place. */
  suppressHandoff?: boolean
  quotaExhausted?: boolean
  now?: Date
}

export function buildFlightState(input: BuildStateInput): FlightState {
  const now = input.now ?? new Date()
  const reconciled = reconcile(input.flight, input.position)
  const phase = computePhase(reconciled, input.position, now)
  const position = toPositionState(input.position, now)

  const traveler =
    [input.people.self, input.people.partner].find((p) => p?.id === reconciled.traveler_id) ?? null

  // The watcher is whoever is not on the plane. Nobody is watching a flight
  // they are on, and a solo user has no watcher at all.
  const watcher =
    input.suppressHandoff || !traveler
      ? null
      : ([input.people.self, input.people.partner].find(
          (p) => p && p.id !== reconciled.traveler_id,
        ) ?? null)

  const state: FlightState = {
    id: reconciled.id,
    flightNumber: reconciled.flight_number,
    callsign: reconciled.callsign,
    icao24: reconciled.icao24,
    registration: reconciled.registration,
    airline: { iata: reconciled.airline_iata, name: reconciled.airline_name },
    travelerId: reconciled.traveler_id,
    traveler,
    watcher,
    phase,
    times: computeTimes(reconciled),
    origin: {
      iata: reconciled.origin_iata,
      name: reconciled.origin_name,
      tz: reconciled.origin_tz,
      lat: reconciled.origin_lat === null ? null : Number(reconciled.origin_lat),
      lng: reconciled.origin_lng === null ? null : Number(reconciled.origin_lng),
      terminal: reconciled.terminal,
      gate: reconciled.gate,
    },
    dest: {
      iata: reconciled.dest_iata,
      name: reconciled.dest_name,
      tz: reconciled.dest_tz,
      lat: reconciled.dest_lat === null ? null : Number(reconciled.dest_lat),
      lng: reconciled.dest_lng === null ? null : Number(reconciled.dest_lng),
      belt: reconciled.baggage_belt,
    },
    position,
    progress: computeProgress(reconciled, position, phase, now),
    freshness: computeFreshness(reconciled, position, phase, now, input.quotaExhausted),
    handoff: null,
    trackingActive: reconciled.tracking_active,
    hasCheckedBags: reconciled.has_checked_bags,
  }

  return {
    ...state,
    handoff: computeHandoff(state, {
      waitTimes: input.waitTimes ?? null,
      watcherHome: input.watcherHome ?? null,
      originCountry: countryOf(reconciled.origin_tz),
      destCountry: countryOf(reconciled.dest_tz),
    }),
  }
}

/**
 * A rough country from an IANA zone, for the immigration guess.
 *
 * 'Europe/Lisbon' does not contain 'PT', so this is a small lookup of the
 * zones the seeded airlines actually fly between. An unrecognised zone falls
 * through to the international default, which is the safe direction: guessing
 * "domestic, no immigration" for an international arrival would send someone
 * to the airport forty-five minutes early.
 */
const ZONE_COUNTRIES: Record<string, string> = {
  'Europe/Lisbon': 'PT',
  'Europe/Madrid': 'ES',
  'Europe/Paris': 'FR',
  'Europe/Berlin': 'DE',
  'Europe/Rome': 'IT',
  'Europe/Amsterdam': 'NL',
  'Europe/Brussels': 'BE',
  'Europe/Vienna': 'AT',
  'Europe/Zurich': 'CH',
  'Europe/Prague': 'CZ',
  'Europe/Warsaw': 'PL',
  'Europe/Stockholm': 'SE',
  'Europe/Oslo': 'NO',
  'Europe/Copenhagen': 'DK',
  'Europe/Helsinki': 'FI',
  'Europe/Athens': 'GR',
  'Europe/London': 'GB',
  'Europe/Dublin': 'IE',
  'Asia/Kolkata': 'IN',
  'Asia/Calcutta': 'IN',
  'Asia/Dubai': 'AE',
  'Asia/Tokyo': 'JP',
  'Asia/Singapore': 'SG',
  'America/Toronto': 'CA',
  'America/Vancouver': 'CA',
  'America/New_York': 'US',
  'America/Los_Angeles': 'US',
  'America/Chicago': 'US',
}

export function countryOf(timezone: string | null): string | null {
  return timezone ? (ZONE_COUNTRIES[timezone] ?? null) : null
}
