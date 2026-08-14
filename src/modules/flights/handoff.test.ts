import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BAGGAGE_MINUTES,
  IMMIGRATION_DEFAULTS,
  computeHandoff,
  describeBreakdown,
  estimateDriveMinutes,
  immigrationMinutes,
} from '@/modules/flights/handoff'
import type { AirportWaitTime, FlightState, Phase } from '@/modules/flights/types'

const LANDING = '2026-06-01T18:00:00Z'

const person = (id: string, isSelf: boolean) => ({
  id,
  displayName: id === 'me' ? 'Ada' : 'Bo',
  avatarUrl: null,
  accentColor: 'amber' as const,
  isSelf,
})

const state = (over: Partial<FlightState> = {}): FlightState =>
  ({
    id: 'f1',
    flightNumber: 'AC42',
    callsign: null,
    icao24: null,
    registration: null,
    airline: { iata: 'AC', name: 'Air Canada' },
    travelerId: 'them',
    traveler: person('them', false),
    watcher: person('me', true),
    phase: 'enroute' as Phase,
    times: {
      scheduledDeparture: null,
      estimatedDeparture: null,
      actualDeparture: null,
      scheduledArrival: LANDING,
      estimatedArrival: null,
      actualArrival: null,
      delayMinutes: 0,
    },
    origin: { iata: 'YYZ', name: null, tz: 'America/Toronto', lat: 43.68, lng: -79.61 },
    dest: { iata: 'LIS', name: null, tz: 'Europe/Lisbon', lat: 38.77, lng: -9.13 },
    position: null,
    progress: {
      fraction: 0.5,
      distanceFlownKm: 0,
      distanceRemainingKm: 0,
      minutesRemaining: null,
      source: 'time',
    },
    freshness: {
      status: { source: 'aerodatabox', ageSeconds: 60 },
      position: { source: 'opensky', ageSeconds: 30 },
      degraded: false,
      notices: [],
      level: 1,
    },
    handoff: null,
    trackingActive: true,
    hasCheckedBags: true,
    ...over,
  }) as FlightState

const waitTimes = (over: Partial<AirportWaitTime> = {}): AirportWaitTime => ({
  iata: 'LIS',
  immigration_minutes: null,
  baggage_minutes: null,
  notes: null,
  updated_by: null,
  updated_at: '2026-01-01T00:00:00Z',
  ...over,
})

/** Minutes between two instants, for asserting on the plan's arithmetic. */
const gap = (from: string, to: string) => (new Date(to).getTime() - new Date(from).getTime()) / 60_000

describe('computeHandoff', () => {
  it('gives nothing when nobody is waiting', () => {
    expect(computeHandoff(state({ watcher: null }))).toBeNull()
  })

  it('gives nothing without a landing time to work back from', () => {
    const noTimes = state({
      times: { ...state().times, scheduledArrival: null },
    })
    expect(computeHandoff(noTimes)).toBeNull()
  })

  it('works back from landing through every step', () => {
    const plan = computeHandoff(state(), {
      watcherHome: { lat: 38.72, lng: -9.14 },
      originCountry: 'CA',
      destCountry: 'PT',
    })!

    const { breakdown } = plan
    // Ready = landing + disembark + immigration + baggage + walk.
    const insideTerminal =
      breakdown.disembark + breakdown.immigration + breakdown.baggage + breakdown.walk
    expect(gap(LANDING, plan.readyAt)).toBe(insideTerminal)
    // Leave = ready − drive − buffer.
    expect(gap(plan.leaveAt, plan.readyAt)).toBe(breakdown.drive + breakdown.buffer)
  })

  it('skips the baggage wait for hand luggage only', () => {
    const withBags = computeHandoff(state())!
    const without = computeHandoff(state({ hasCheckedBags: false }))!

    expect(withBags.breakdown.baggage).toBe(DEFAULT_BAGGAGE_MINUTES)
    expect(without.breakdown.baggage).toBe(0)
    // Out of the terminal sooner, so the driver has to set off sooner too.
    expect(new Date(without.leaveAt).getTime()).toBeLessThan(new Date(withBags.leaveAt).getTime())
  })

  it('prefers a measured wait over the default', () => {
    const plan = computeHandoff(state(), {
      waitTimes: waitTimes({ immigration_minutes: 12, baggage_minutes: 8 }),
    })!
    expect(plan.breakdown.immigration).toBe(12)
    expect(plan.breakdown.baggage).toBe(8)
  })

  it('is rough when the flight data is not fresh', () => {
    const stale = state({
      freshness: { ...state().freshness, status: { source: 'cache', ageSeconds: 3600 } },
    })
    expect(computeHandoff(stale)!.confidence).toBe('rough')
    expect(computeHandoff(state())!.confidence).toBe('good')
  })

  it('voids itself loudly on a diversion', () => {
    // The worst failure this module can produce is a confident drive to the
    // wrong airport, so the plan says so rather than quietly updating.
    const plan = computeHandoff(state({ phase: 'diverted' }))!
    expect(plan.voidReason).toContain('diverted')
  })

  it('voids itself on a cancellation too', () => {
    expect(computeHandoff(state({ phase: 'cancelled' }))!.voidReason).toBe('Flight cancelled.')
  })

  it('prefers an actual arrival over the schedule', () => {
    const early = computeHandoff(
      state({
        times: { ...state().times, actualArrival: '2026-06-01T17:30:00Z' },
      }),
    )!
    const onSchedule = computeHandoff(state())!
    expect(gap('2026-06-01T17:30:00Z', early.readyAt)).toBeGreaterThan(0)
    // Landed half an hour early, so everything downstream moves half an hour.
    expect(gap(early.readyAt, onSchedule.readyAt)).toBe(30)
  })
})

describe('immigrationMinutes', () => {
  it('is nothing at all for a domestic arrival', () => {
    expect(immigrationMinutes('YYZ', { originCountry: 'CA', destCountry: 'CA' })).toBe(
      IMMIGRATION_DEFAULTS.domestic,
    )
  })

  it('is short between two Schengen countries', () => {
    expect(immigrationMinutes('LIS', { originCountry: 'FR', destCountry: 'PT' })).toBe(
      IMMIGRATION_DEFAULTS.schengenInternal,
    )
  })

  it('is longer at a known-busy airport', () => {
    expect(immigrationMinutes('LHR', { originCountry: 'US', destCountry: 'GB' })).toBe(
      IMMIGRATION_DEFAULTS.busy,
    )
  })

  it('falls back to the international default', () => {
    expect(immigrationMinutes('LIS', { originCountry: 'CA', destCountry: 'PT' })).toBe(
      IMMIGRATION_DEFAULTS.international,
    )
  })

  it('guesses international rather than domestic when the countries are unknown', () => {
    // The safe direction to be wrong in: too early beats missing them.
    expect(immigrationMinutes('LIS', {})).toBe(IMMIGRATION_DEFAULTS.international)
  })

  it('lets a measured number beat every rule', () => {
    expect(
      immigrationMinutes('LHR', {
        waitTimes: waitTimes({ iata: 'LHR', immigration_minutes: 5 }),
        originCountry: 'US',
        destCountry: 'GB',
      }),
    ).toBe(5)
  })
})

describe('estimateDriveMinutes', () => {
  it('is zero without a home to drive from', () => {
    expect(estimateDriveMinutes(null, { lat: 38.77, lng: -9.13 })).toBe(0)
  })

  it('scales with distance', () => {
    const near = estimateDriveMinutes({ lat: 38.72, lng: -9.14 }, { lat: 38.77, lng: -9.13 })
    const far = estimateDriveMinutes({ lat: 38.0, lng: -9.14 }, { lat: 38.77, lng: -9.13 })
    expect(far).toBeGreaterThan(near)
    expect(near).toBeGreaterThan(0)
  })
})

describe('describeBreakdown', () => {
  it('hides the steps that take no time', () => {
    const plan = computeHandoff(
      state({ hasCheckedBags: false }),
      { originCountry: 'PT', destCountry: 'PT' },
    )!
    const labels = describeBreakdown(plan).map((p) => p.label)
    expect(labels).not.toContain('Baggage')
    expect(labels).not.toContain('Immigration')
    expect(labels).toContain('Off the plane')
  })
})
