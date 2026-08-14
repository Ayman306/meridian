import { describe, expect, it } from 'vitest'
import {
  describeJourney,
  nextLegIndex,
  summariseJourney,
  bothFlying,
  computeFreshness,
  computePhase,
  computeProgress,
  computeTimes,
  connectionRisk,
  connectionsFor,
  estimatedPosition,
  groupFlight,
  isDiverted,
  needsRefresh,
  normaliseFlightNumber,
  positionConfidence,
  positionMaxAgeSeconds,
  reconcile,
  statusMaxAgeSeconds,
  toCallsign,
  toPositionState,
} from '@/modules/flights/logic'
import { buildFlightState } from '@/modules/flights/state'
import type { FlightPosition, FlightRow, FlightState } from '@/modules/flights/types'

const LHR = { lat: 51.47, lng: -0.4543 }
const JFK = { lat: 40.6413, lng: -73.7781 }

const NOW = new Date('2026-06-01T12:00:00Z')
const at = (minutesFromNow: number) =>
  new Date(NOW.getTime() + minutesFromNow * 60_000).toISOString()

let seq = 0
const flight = (over: Partial<FlightRow> = {}): FlightRow => ({
  id: `f${++seq}`,
  couple_id: 'c1',
  journey_id: null,
  trip_id: null,
  traveler_id: 'me',
  leg_index: 1,
  flight_number: 'AC42',
  callsign: 'ACA42',
  icao24: null,
  registration: null,
  airline_iata: 'AC',
  airline_name: 'Air Canada',
  flight_date: '2026-06-01',
  origin_iata: 'LHR',
  origin_name: 'Heathrow',
  origin_tz: 'Europe/London',
  origin_lat: LHR.lat,
  origin_lng: LHR.lng,
  dest_iata: 'JFK',
  dest_name: 'Kennedy',
  dest_tz: 'America/New_York',
  dest_lat: JFK.lat,
  dest_lng: JFK.lng,
  scheduled_departure: at(-60),
  scheduled_arrival: at(300),
  estimated_departure: null,
  estimated_arrival: null,
  actual_departure: null,
  actual_arrival: null,
  gate: null,
  terminal: null,
  baggage_belt: null,
  aircraft_type: null,
  phase: 'scheduled',
  has_checked_bags: true,
  tracking_active: true,
  status_polled_at: null,
  position_polled_at: null,
  status_error_count: 0,
  position_error_count: 0,
  manual_override: null,
  raw_status: null,
  created_by: null,
  created_at: '2026-05-01T00:00:00Z',
  updated_at: '2026-05-01T00:00:00Z',
  deleted_at: null,
  ...over,
})

const position = (over: Partial<FlightPosition> = {}): FlightPosition => ({
  id: `p${++seq}`,
  flight_id: 'f1',
  // On the LHR–JFK great circle, 40% along. Off-track coordinates would trip
  // the diversion check in every test that uses the default fixture.
  lat: 53.21,
  lng: -33.24,
  altitude_m: 11000,
  heading: 280,
  velocity_ms: 250,
  vertical_rate: 0,
  on_ground: false,
  source: 'opensky',
  recorded_at: at(-1),
  created_at: at(-1),
  ...over,
})

describe('normaliseFlightNumber', () => {
  it('treats AC 42, ac0042 and AC42 as the same flight', () => {
    // The spec's acceptance test, verbatim.
    expect(normaliseFlightNumber('AC 42')).toBe('AC42')
    expect(normaliseFlightNumber('ac0042')).toBe('AC42')
    expect(normaliseFlightNumber('AC42')).toBe('AC42')
  })

  it('handles prefixes containing a digit', () => {
    expect(normaliseFlightNumber('6e 1234')).toBe('6E1234')
    expect(normaliseFlightNumber('u2 0007')).toBe('U27')
  })

  it('leaves something unparseable alone rather than mangling it', () => {
    expect(normaliseFlightNumber('not-a-flight')).toBe('NOTAFLIGHT')
  })
})

describe('toCallsign', () => {
  it('turns AC42 into ACA42', () => {
    expect(toCallsign('AC42', 'ACA')).toBe('ACA42')
  })

  it('gives nothing without an ICAO code — position tracking is then off', () => {
    expect(toCallsign('AC42', null)).toBeNull()
  })
})

describe('computePhase', () => {
  it('is scheduled well before departure', () => {
    expect(computePhase(flight({ scheduled_departure: at(600) }), null, NOW)).toBe('scheduled')
  })

  it('opens check-in three hours out', () => {
    expect(computePhase(flight({ scheduled_departure: at(150) }), null, NOW)).toBe('checkin')
  })

  it('is boarding once a gate is posted within the hour', () => {
    expect(computePhase(flight({ scheduled_departure: at(40), gate: 'B12' }), null, NOW)).toBe(
      'boarding',
    )
  })

  it('is enroute ten minutes after a recorded departure', () => {
    expect(computePhase(flight({ actual_departure: at(-30) }), null, NOW)).toBe('enroute')
  })

  it('is descending inside the last hour', () => {
    expect(
      computePhase(flight({ actual_departure: at(-300), scheduled_arrival: at(30) }), null, NOW),
    ).toBe('descending')
  })

  it('is descending on a negative vertical rate, whatever the schedule says', () => {
    const phase = computePhase(
      flight({ actual_departure: at(-120), scheduled_arrival: at(200) }),
      position({ vertical_rate: -8 }),
      NOW,
    )
    expect(phase).toBe('descending')
  })

  it('is landed once an arrival is recorded', () => {
    expect(computePhase(flight({ actual_arrival: at(-5) }), null, NOW)).toBe('landed')
  })

  it('lets a manual override win over everything', () => {
    const phase = computePhase(
      flight({ actual_arrival: at(-5), manual_override: { phase: 'diverted' } }),
      null,
      NOW,
    )
    expect(phase).toBe('diverted')
  })

  it('has nothing to say without any times', () => {
    expect(computePhase(flight({ scheduled_departure: null }), null, NOW)).toBe('unknown')
  })
})

describe('reconcile', () => {
  it('lands the flight on ground contact at the destination, even while the airline says enroute', () => {
    // Spec 9.5: this is the one case where OpenSky beats AeroDataBox. ADS-B
    // ground contact is a hard fact; the airline reports the gate and lags.
    const row = flight({ phase: 'enroute', actual_departure: at(-300) })
    const onGround = position({ lat: JFK.lat, lng: JFK.lng, on_ground: true, recorded_at: at(-2) })

    const result = reconcile(row, onGround)
    expect(result.phase).toBe('landed')
    expect(result.actual_arrival).toBe(at(-2))
  })

  it('does not land it on ground contact somewhere else', () => {
    const row = flight({ phase: 'enroute', actual_departure: at(-300) })
    const elsewhere = position({ lat: 45, lng: -60, on_ground: true })
    expect(reconcile(row, elsewhere).phase).not.toBe('landed')
  })

  it('promotes a scheduled flight that is visibly airborne', () => {
    const result = reconcile(flight({ phase: 'scheduled' }), position())
    expect(result.phase).toBe('enroute')
    expect(result.actual_departure).toBe(position().recorded_at)
  })

  it('flags a diversion when the aircraft is far off the corridor', () => {
    // 300 km north of the London–New York track.
    const row = flight({ phase: 'enroute', actual_departure: at(-120) })
    const off = position({ lat: 64.13, lng: -21.94 })
    expect(reconcile(row, off).phase).toBe('diverted')
  })

  it('applies the manual override last, so nothing can undo it', () => {
    const row = flight({ phase: 'scheduled', manual_override: { gate: 'A1', phase: 'boarding' } })
    const result = reconcile(row, position())
    expect(result.phase).toBe('boarding')
    expect(result.gate).toBe('A1')
  })
})

describe('isDiverted', () => {
  it('says nothing about an aircraft on the ground', () => {
    expect(isDiverted(flight(), position({ on_ground: true, lat: 64, lng: -21 }))).toBe(false)
  })

  it('says nothing without coordinates for the route', () => {
    expect(isDiverted(flight({ dest_lat: null, dest_lng: null }), position())).toBe(false)
  })
})

describe('statusMaxAgeSeconds — the budget', () => {
  it('checks a flight two days out about once a day', () => {
    expect(statusMaxAgeSeconds('scheduled', 60 * 60, null)).toBe(24 * 60 * 60)
  })

  it('tightens as departure approaches', () => {
    expect(statusMaxAgeSeconds('scheduled', 20 * 60, null)).toBe(6 * 60 * 60)
    expect(statusMaxAgeSeconds('checkin', 120, null)).toBe(30 * 60)
    expect(statusMaxAgeSeconds('boarding', 30, null)).toBe(10 * 60)
  })

  it('polls every two minutes in the final hour of the flight', () => {
    // The expensive window, and the one that matters: gate, belt and delay
    // all change here, and someone is driving to the airport on the answer.
    expect(statusMaxAgeSeconds('descending', null, 30)).toBe(2 * 60)
  })

  it('is relaxed mid-flight', () => {
    expect(statusMaxAgeSeconds('enroute', null, 300)).toBe(15 * 60)
  })

  it('never polls a finished flight', () => {
    expect(statusMaxAgeSeconds('landed', null, null)).toBeNull()
    expect(statusMaxAgeSeconds('cancelled', null, null)).toBeNull()
  })
})

describe('positionMaxAgeSeconds', () => {
  it('is a minute while airborne and nothing otherwise', () => {
    expect(positionMaxAgeSeconds('enroute')).toBe(55)
    expect(positionMaxAgeSeconds('scheduled')).toBeNull()
    expect(positionMaxAgeSeconds('landed')).toBeNull()
  })
})

describe('needsRefresh', () => {
  it('never refreshes when the max age is null', () => {
    expect(needsRefresh(null, null, NOW)).toBe(false)
  })

  it('refreshes something never polled', () => {
    expect(needsRefresh(null, 600, NOW)).toBe(true)
  })

  it('holds off inside the window', () => {
    expect(needsRefresh(at(-5), 600, NOW)).toBe(false)
    expect(needsRefresh(at(-15), 600, NOW)).toBe(true)
  })
})

describe('positionConfidence', () => {
  it('grades a fix by age', () => {
    expect(positionConfidence(30)).toBe('live')
    expect(positionConfidence(300)).toBe('stale')
    expect(positionConfidence(3600)).toBe('estimated')
    expect(positionConfidence(null)).toBe('none')
  })
})

describe('computeFreshness — the degradation ladder', () => {
  const fresh = (over: Partial<FlightRow> = {}) => flight({ status_polled_at: at(-2), ...over })

  it('is level 1 with both sources live', () => {
    const state = toPositionState(position({ recorded_at: at(-0.5) }), NOW)
    const freshness = computeFreshness(fresh(), state, 'enroute', NOW)
    expect(freshness.level).toBe(1)
    expect(freshness.notices).toHaveLength(0)
    expect(freshness.degraded).toBe(false)
  })

  it('says when the position is stale rather than hiding it', () => {
    const state = toPositionState(position({ recorded_at: at(-10) }), NOW)
    const freshness = computeFreshness(fresh(), state, 'enroute', NOW)
    expect(freshness.level).toBe(2)
    expect(freshness.notices[0]).toContain('Position last seen')
  })

  it('treats mid-ocean as normal, not as a failure', () => {
    // Level 3 is where a trans-Atlantic flight spends hours. The copy must
    // not sound alarmed.
    const freshness = computeFreshness(fresh(), null, 'enroute', NOW)
    expect(freshness.level).toBe(3)
    expect(freshness.notices.join(' ')).toContain('no radar coverage')
  })

  it('falls back to scheduled times with nothing at all', () => {
    const freshness = computeFreshness(flight(), null, 'scheduled', NOW)
    expect(freshness.level).toBe(6)
    expect(freshness.notices).toContain('Showing scheduled times.')
  })

  it('reaches level 7 when the quota is gone', () => {
    const freshness = computeFreshness(fresh(), null, 'scheduled', NOW, true)
    expect(freshness.level).toBe(7)
    expect(freshness.notices.join(' ')).toContain('allowance')
  })

  it('always reports where each half came from', () => {
    const state = toPositionState(position({ recorded_at: at(-0.5) }), NOW)
    const freshness = computeFreshness(fresh(), state, 'enroute', NOW)
    expect(freshness.status.source).toBe('aerodatabox')
    expect(freshness.position.source).toBe('opensky')
    expect(freshness.position.ageSeconds).toBeGreaterThanOrEqual(0)
  })
})

describe('computeProgress', () => {
  it('prefers the aircraft over the schedule, and says which', () => {
    const state = toPositionState(position({ recorded_at: at(-0.5) }), NOW)
    const progress = computeProgress(flight({ actual_departure: at(-120) }), state, 'enroute', NOW)

    expect(progress.source).toBe('position')
    expect(progress.fraction).toBeGreaterThan(0)
    expect(progress.fraction).toBeLessThan(1)
    expect(progress.distanceRemainingKm).toBeGreaterThan(0)
  })

  it('falls back to elapsed time when there is no usable fix', () => {
    const row = flight({ actual_departure: at(-180), scheduled_arrival: at(180) })
    const progress = computeProgress(row, null, 'enroute', NOW)
    expect(progress.source).toBe('time')
    expect(progress.fraction).toBeCloseTo(0.5, 1)
  })

  it('is complete once landed', () => {
    const row = flight({ actual_departure: at(-300), actual_arrival: at(-5) })
    expect(computeProgress(row, null, 'landed', NOW).fraction).toBe(1)
  })

  it('gives no ETA from a stationary fix rather than dividing by nothing', () => {
    const state = toPositionState(position({ velocity_ms: 0, recorded_at: at(-0.5) }), NOW)
    expect(computeProgress(flight(), state, 'enroute', NOW).minutesRemaining).toBeNull()
  })
})

describe('estimatedPosition', () => {
  it('sits on the great circle at the given fraction', () => {
    const point = estimatedPosition(flight(), 0.5)
    expect(point).not.toBeNull()
    // North of the naive average — it is a great circle, not a straight line.
    expect(point!.lat).toBeGreaterThan((LHR.lat + JFK.lat) / 2)
  })

  it('gives nothing without both endpoints', () => {
    expect(estimatedPosition(flight({ dest_lat: null }), 0.5)).toBeNull()
  })
})

describe('computeTimes', () => {
  it('reports a delay as a signed number', () => {
    const late = computeTimes(flight({ scheduled_arrival: at(0), estimated_arrival: at(35) }))
    expect(late.delayMinutes).toBe(35)

    const early = computeTimes(flight({ scheduled_arrival: at(0), estimated_arrival: at(-12) }))
    expect(early.delayMinutes).toBe(-12)
  })

  it('prefers an actual arrival over an estimate', () => {
    const times = computeTimes(
      flight({ scheduled_arrival: at(0), estimated_arrival: at(30), actual_arrival: at(10) }),
    )
    expect(times.delayMinutes).toBe(10)
  })
})

describe('connectionRisk', () => {
  const leg1 = (arrival: string) =>
    flight({ id: 'leg1', scheduled_arrival: arrival, terminal: '2', dest_iata: 'AMS' })
  const leg2 = (departure: string, terminal = '2') =>
    flight({ id: 'leg2', scheduled_departure: departure, terminal, origin_iata: 'AMS' })

  it('is fine with a comfortable gap', () => {
    expect(connectionRisk(leg1(at(0)), leg2(at(120)))?.risk).toBe('ok')
  })

  it('is tight below the minimum', () => {
    expect(connectionRisk(leg1(at(0)), leg2(at(40)))?.risk).toBe('tight')
  })

  it('is high risk well below it', () => {
    expect(connectionRisk(leg1(at(0)), leg2(at(20)))?.risk).toBe('high')
  })

  it('needs longer between terminals', () => {
    const same = connectionRisk(leg1(at(0)), leg2(at(70), '2'))
    const different = connectionRisk(leg1(at(0)), leg2(at(70), '5'))
    expect(same!.minimumMinutes).toBe(45)
    expect(different!.minimumMinutes).toBe(90)
    // The same seventy minutes is comfortable in one terminal and tight
    // across two.
    expect(same!.risk).toBe('ok')
    expect(different!.risk).toBe('tight')
  })

  it('uses the estimated arrival, so a delay changes the answer', () => {
    const delayed = flight({
      id: 'leg1',
      scheduled_arrival: at(0),
      estimated_arrival: at(70),
      terminal: '2',
    })
    expect(connectionRisk(delayed, leg2(at(90)))?.risk).toBe('high')
  })

  it('says nothing without both times', () => {
    expect(connectionRisk(flight({ scheduled_arrival: null }), leg2(at(90)))).toBeNull()
  })
})

describe('connectionsFor', () => {
  it('pairs consecutive legs in order', () => {
    const legs = [
      flight({ id: 'b', leg_index: 2, scheduled_arrival: at(400), scheduled_departure: at(200) }),
      flight({ id: 'a', leg_index: 1, scheduled_arrival: at(100), scheduled_departure: at(-60) }),
    ]
    const connections = connectionsFor(legs)
    expect(connections).toHaveLength(1)
    expect(connections[0]!.fromFlightId).toBe('a')
    expect(connections[0]!.toFlightId).toBe('b')
  })
})

describe('groupFlight', () => {
  it('sorts flights into active, upcoming and past', () => {
    expect(groupFlight(flight(), 'enroute', NOW)).toBe('active')
    expect(groupFlight(flight(), 'boarding', NOW)).toBe('active')
    expect(groupFlight(flight({ scheduled_departure: at(600) }), 'scheduled', NOW)).toBe('upcoming')
    expect(groupFlight(flight(), 'landed', NOW)).toBe('past')
  })

  it('treats a departure time in the past as past, whatever the phase says', () => {
    expect(groupFlight(flight({ scheduled_departure: at(-600) }), 'scheduled', NOW)).toBe('past')
  })
})

describe('bothFlying', () => {
  const state = (travelerId: string, destIata: string, arrival: string): FlightState =>
    buildFlightState({
      flight: flight({ traveler_id: travelerId, dest_iata: destIata, scheduled_arrival: arrival }),
      position: null,
      people: { self: null, partner: null },
      now: NOW,
    })

  it('spots two people converging on one airport', () => {
    const result = bothFlying([state('me', 'LIS', at(100)), state('them', 'LIS', at(160))])
    expect(result.isBoth).toBe(true)
    expect(result.gapMinutes).toBe(60)
  })

  it('is not both when they are going to different places', () => {
    expect(bothFlying([state('me', 'LIS', at(100)), state('them', 'CDG', at(160))]).isBoth).toBe(
      false,
    )
  })

  it('is not both when it is one person twice', () => {
    expect(bothFlying([state('me', 'LIS', at(100)), state('me', 'LIS', at(160))]).isBoth).toBe(false)
  })
})

describe('journeys', () => {
  const leg = (over: Partial<FlightRow> = {}): FlightRow =>
    ({
      id: 'f1',
      couple_id: 'c1',
      journey_id: 'j1',
      trip_id: null,
      traveler_id: 'u1',
      leg_index: 1,
      flight_number: '6E1468',
      flight_date: '2026-11-03',
      origin_iata: 'DXB',
      dest_iata: 'IXE',
      scheduled_departure: '2026-11-03T07:25:00Z',
      scheduled_arrival: '2026-11-03T11:00:00Z',
      estimated_arrival: null,
      terminal: null,
      deleted_at: null,
      phase: 'scheduled',
      ...over,
    }) as FlightRow

  it('reads a direct flight as direct', () => {
    const summary = summariseJourney([leg()])
    expect(summary.originIata).toBe('DXB')
    expect(summary.destIata).toBe('IXE')
    expect(summary.stops).toEqual([])
    expect(describeJourney(summary)).toBe('DXB → IXE · direct')
  })

  it('takes the endpoints from the first and last leg, not the first row', () => {
    const summary = summariseJourney([
      leg({ id: 'b', leg_index: 2, origin_iata: 'BOM', dest_iata: 'IXE' }),
      leg({ id: 'a', leg_index: 1, origin_iata: 'DXB', dest_iata: 'BOM' }),
    ])
    expect(summary.originIata).toBe('DXB')
    expect(summary.destIata).toBe('IXE')
    expect(summary.stops).toEqual(['BOM'])
    expect(describeJourney(summary)).toBe('DXB → IXE · 1 stop (BOM)')
  })

  it('orders by leg index, so an untimed leg still sits in the right place', () => {
    const summary = summariseJourney([
      leg({ id: 'c', leg_index: 3, scheduled_departure: null }),
      leg({ id: 'a', leg_index: 1 }),
      leg({ id: 'b', leg_index: 2, scheduled_departure: null }),
    ])
    expect(summary.legs.map((l) => l.flight.id)).toEqual(['a', 'b', 'c'])
  })

  it('flags a tight connection between consecutive legs', () => {
    const summary = summariseJourney([
      leg({ id: 'a', leg_index: 1, dest_iata: 'BOM', scheduled_arrival: '2026-11-03T11:00:00Z' }),
      leg({
        id: 'b',
        leg_index: 2,
        origin_iata: 'BOM',
        // 50 minutes later, against a 90-minute international minimum.
        scheduled_departure: '2026-11-03T11:50:00Z',
      }),
    ])
    expect(summary.legs[0]!.connection).toBeNull()
    expect(summary.legs[1]!.connection?.bufferMinutes).toBe(50)
    expect(summary.worstRisk).toBe('high')
  })

  it('is content with a generous layover', () => {
    const summary = summariseJourney([
      leg({ id: 'a', leg_index: 1, scheduled_arrival: '2026-11-03T11:00:00Z' }),
      leg({ id: 'b', leg_index: 2, scheduled_departure: '2026-11-03T14:00:00Z' }),
    ])
    expect(summary.worstRisk).toBe('ok')
  })

  it('has no risk to report on a direct flight', () => {
    expect(summariseJourney([leg()]).worstRisk).toBeNull()
  })

  it('measures the whole journey door to door, layovers included', () => {
    const summary = summariseJourney([
      leg({ id: 'a', leg_index: 1, scheduled_departure: '2026-11-03T07:00:00Z', scheduled_arrival: '2026-11-03T10:00:00Z' }),
      leg({ id: 'b', leg_index: 2, scheduled_departure: '2026-11-03T12:00:00Z', scheduled_arrival: '2026-11-03T14:00:00Z' }),
    ])
    expect(summary.totalMinutes).toBe(420)
  })

  it('ignores deleted legs', () => {
    const summary = summariseJourney([
      leg({ id: 'a', leg_index: 1 }),
      leg({ id: 'b', leg_index: 2, deleted_at: '2026-01-01T00:00:00Z' }),
    ])
    expect(summary.legs).toHaveLength(1)
    expect(summary.stops).toEqual([])
  })

  it('says so plainly when the route is not set yet', () => {
    const summary = summariseJourney([leg({ origin_iata: null, dest_iata: null })])
    expect(describeJourney(summary)).toBe('Route not set · direct')
  })

  it('picks a leg index that cannot collide after a removal', () => {
    expect(nextLegIndex([])).toBe(1)
    expect(nextLegIndex([leg({ leg_index: 1 }), leg({ leg_index: 3 })])).toBe(4)
  })
})
