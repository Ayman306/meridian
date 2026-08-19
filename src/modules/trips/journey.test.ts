/**
 * The journey model is what the trip's opening screen draws, so a wrong answer
 * here is a wrong picture somebody plans a trip from. These tests pin the three
 * decisions that are easy to get subtly wrong: how flights sit in a day, what
 * counts as an empty day, and which day the screen opens on.
 */
import { describe, expect, it } from 'vitest'
import {
  buildJourney,
  describeTripJourney,
  focusDay,
  journeyCentre,
  nearbyWishlist,
  type JourneyInput,
} from './journey'

const EMPTY: JourneyInput = {
  startDate: null,
  endDate: null,
  days: [],
  flights: [],
  items: [],
  destinations: [],
}

function input(patch: Partial<JourneyInput>): JourneyInput {
  return { ...EMPTY, ...patch }
}

const flight = (patch: Partial<JourneyInput['flights'][number]>): JourneyInput['flights'][number] => ({
  id: 'f1',
  flight_number: 'AC42',
  flight_date: '2026-03-01',
  origin_iata: 'YYZ',
  dest_iata: 'LHR',
  origin_lat: 43.68,
  origin_lng: -79.63,
  dest_lat: 51.47,
  dest_lng: -0.45,
  scheduled_departure: '2026-03-01T22:00:00Z',
  scheduled_arrival: '2026-03-02T10:00:00Z',
  ...patch,
})

const item = (patch: Partial<JourneyInput['items'][number]>): JourneyInput['items'][number] => ({
  id: 'i1',
  title: 'Borough Market',
  scheduled_date: '2026-03-02',
  start_time: '11:00',
  place_name: 'Borough Market',
  state: 'accepted',
  lat: 51.505,
  lng: -0.09,
  ...patch,
})

describe('the shape of the timeline', () => {
  it('derives days from the trip dates when no rows exist yet', () => {
    // A trip whose days have not been synced should still draw. Showing an
    // empty screen there looks like a broken app rather than a new trip.
    const journey = buildJourney(input({ startDate: '2026-03-01', endDate: '2026-03-04' }))
    expect(journey.days.map((d) => d.date)).toEqual([
      '2026-03-01',
      '2026-03-02',
      '2026-03-03',
      '2026-03-04',
    ])
    expect(journey.days[0]!.index).toBe(1)
  })

  it('prefers the stored days, in date order, however they arrived', () => {
    const journey = buildJourney(
      input({
        startDate: '2026-03-01',
        endDate: '2026-03-03',
        days: [
          { date: '2026-03-03', day_type: 'rest', title: null, note: null },
          { date: '2026-03-01', day_type: 'travel', title: 'Fly out', note: null },
        ],
      }),
    )
    expect(journey.days.map((d) => d.date)).toEqual(['2026-03-01', '2026-03-03'])
    expect(journey.days[0]!.title).toBe('Fly out')
  })

  it('has nothing to draw without dates', () => {
    expect(buildJourney(EMPTY).days).toEqual([])
    expect(describeTripJourney(buildJourney(EMPTY))).toMatch(/no dates/i)
  })

  it('treats a single-day trip as one day, not zero', () => {
    const journey = buildJourney(input({ startDate: '2026-03-01', endDate: '2026-03-01' }))
    expect(journey.days).toHaveLength(1)
  })
})

describe('how a day is ordered', () => {
  it('puts an arrival before everything planned and a departure after', () => {
    // The rule that a time sort would get right only by accident: an arrival at
    // 06:00 brackets the front of the day, a departure the back, regardless of
    // whether anything planned has a time at all.
    const journey = buildJourney(
      input({
        startDate: '2026-03-02',
        endDate: '2026-03-02',
        flights: [
          flight({ id: 'in', origin_iata: null, flight_date: '2026-03-02' }),
          flight({ id: 'out', dest_iata: null, flight_date: '2026-03-02', flight_number: 'BA1' }),
        ],
        items: [item({ id: 'a', start_time: null })],
      }),
    )
    expect(journey.days[0]!.entries.map((e) => e.kind)).toEqual(['arrive', 'item', 'depart'])
  })

  it('sorts timed items before untimed ones', () => {
    // "Sometime today" is not a claim about being early, so it goes last.
    const journey = buildJourney(
      input({
        startDate: '2026-03-02',
        endDate: '2026-03-02',
        items: [
          item({ id: 'late', title: 'Dinner', start_time: '20:00' }),
          item({ id: 'whenever', title: 'Bookshop', start_time: null }),
          item({ id: 'early', title: 'Coffee', start_time: '08:00' }),
        ],
      }),
    )
    expect(journey.days[0]!.entries.map((e) => e.id)).toEqual(['early', 'late', 'whenever'])
  })
})

describe('open days and rest days', () => {
  it('keeps them apart', () => {
    // Non-negotiable #6. A rest day is the point of a long stay; an open day is
    // one nobody has reached yet. Collapsing them would put a call to action on
    // a day that was deliberately left blank.
    const journey = buildJourney(
      input({
        days: [
          { date: '2026-03-01', day_type: 'rest', title: null, note: null },
          { date: '2026-03-02', day_type: 'open', title: null, note: null },
        ],
      }),
    )
    expect(journey.days[0]).toMatchObject({ isRest: true, isOpen: false })
    expect(journey.days[1]).toMatchObject({ isRest: false, isOpen: true })
    expect(journey.restDays).toBe(1)
    expect(journey.openDays).toBe(1)
  })

  it('does not call a day open when a flight fills it', () => {
    const journey = buildJourney(
      input({ startDate: '2026-03-01', endDate: '2026-03-01', flights: [flight({})] }),
    )
    expect(journey.days[0]).toMatchObject({ isOpen: false, isTravel: true })
  })

  it('does not call a day open when something is planned', () => {
    const journey = buildJourney(
      input({ startDate: '2026-03-02', endDate: '2026-03-02', items: [item({})] }),
    )
    expect(journey.days[0]!.isOpen).toBe(false)
    expect(journey.plannedDays).toBe(1)
  })
})

describe('which destination a day belongs to', () => {
  const destinations: JourneyInput['destinations'] = [
    {
      city: 'London',
      arrive_on: '2026-03-02',
      depart_on: '2026-03-05',
      lat: 51.5,
      lng: -0.12,
      state: 'chosen',
    },
    {
      city: 'Nowhere',
      arrive_on: '2026-03-02',
      depart_on: '2026-03-05',
      lat: 0,
      lng: 0,
      state: 'rejected',
    },
  ]

  it('covers every night of the stay', () => {
    const journey = buildJourney(
      input({ startDate: '2026-03-01', endDate: '2026-03-06', destinations }),
    )
    expect(journey.days.map((d) => d.place)).toEqual([
      null,
      'London',
      'London',
      'London',
      'London',
      null,
    ])
  })

  it('ignores a rejected candidate', () => {
    const journey = buildJourney(
      input({ startDate: '2026-03-03', endDate: '2026-03-03', destinations }),
    )
    expect(journey.days[0]!.place).toBe('London')
  })

  it('treats a one-night stay with no departure as covering its arrival day', () => {
    const journey = buildJourney(
      input({
        startDate: '2026-03-02',
        endDate: '2026-03-02',
        destinations: [
          { city: 'Bath', arrive_on: '2026-03-02', depart_on: null, lat: 51.4, lng: -2.4, state: 'chosen' },
        ],
      }),
    )
    expect(journey.days[0]!.place).toBe('Bath')
  })
})

describe('the route', () => {
  it('runs origin airport, destination airport, then what is planned', () => {
    const journey = buildJourney(
      input({
        startDate: '2026-03-01',
        endDate: '2026-03-02',
        flights: [flight({})],
        destinations: [
          { city: 'London', arrive_on: '2026-03-02', depart_on: '2026-03-04', lat: 51.5, lng: -0.12, state: 'chosen' },
        ],
        items: [item({})],
      }),
    )
    expect(journey.route.map((p) => p.kind)).toEqual([
      'airport',
      'airport',
      'destination',
      'item',
    ])
    expect(journey.route.map((p) => p.label)).toEqual(['YYZ', 'LHR', 'London', 'Borough Market'])
    expect(journey.totalKm).toBeGreaterThan(0)
  })

  it('skips anything without coordinates rather than guessing at one', () => {
    // A route drawn through an invented point looks right in every field a
    // person reads and is wrong only on the map, which is the one place nobody
    // double-checks.
    const journey = buildJourney(
      input({
        startDate: '2026-03-02',
        endDate: '2026-03-02',
        items: [item({ id: 'nowhere', lat: null, lng: null }), item({ id: 'somewhere' })],
      }),
    )
    expect(journey.route).toHaveLength(1)
  })

  it('does not repeat a point that has not moved', () => {
    const journey = buildJourney(
      input({
        startDate: '2026-03-02',
        endDate: '2026-03-02',
        items: [item({ id: 'a' }), item({ id: 'b', title: 'Again' })],
      }),
    )
    expect(journey.route).toHaveLength(1)
    expect(journey.totalKm).toBe(0)
  })

  it('centres on the chosen destination, and on the arrival airport before one exists', () => {
    const withDestination = buildJourney(
      input({
        startDate: '2026-03-02',
        endDate: '2026-03-02',
        destinations: [
          { city: 'London', arrive_on: '2026-03-02', depart_on: null, lat: 51.5, lng: -0.12, state: 'chosen' },
        ],
      }),
    )
    expect(journeyCentre(withDestination)).toEqual({ lat: 51.5, lng: -0.12 })

    const flightsOnly = buildJourney(
      input({ startDate: '2026-03-01', endDate: '2026-03-01', flights: [flight({})] }),
    )
    expect(journeyCentre(flightsOnly)?.lat).toBeCloseTo(51.47, 1)

    expect(journeyCentre(buildJourney(EMPTY))).toBeNull()
  })
})

describe('the saved places worth offering', () => {
  const wishlist = [
    { id: 'near', title: 'Tate Modern', lat: 51.507, lng: -0.099 },
    { id: 'far', title: 'Edinburgh Castle', lat: 55.948, lng: -3.199 },
    { id: 'unplaced', title: 'Somewhere', lat: null, lng: null },
  ]
  const centre = { lat: 51.5, lng: -0.12 }

  it('offers what is close, nearest first', () => {
    const offered = nearbyWishlist(wishlist, centre, [])
    expect(offered.map((o) => o.item.id)).toEqual(['near'])
  })

  it('leaves out anything already planned, matching on title as the database does', () => {
    // The same comparison push_wishlist_to_itinerary makes. A different rule
    // here would offer somebody a place the database then refuses to add.
    expect(nearbyWishlist(wishlist, centre, ['tate modern'])).toEqual([])
    expect(nearbyWishlist(wishlist, centre, ['TATE MODERN'])).toEqual([])
  })

  it('offers nothing when the trip has no location yet', () => {
    expect(nearbyWishlist(wishlist, null, [])).toEqual([])
  })
})

describe('which day the screen opens on', () => {
  const journey = buildJourney(
    input({
      startDate: '2026-03-01',
      endDate: '2026-03-05',
      flights: [flight({ flight_date: '2026-03-02' })],
    }),
  )

  it('opens on today while the trip is running', () => {
    expect(focusDay(journey, '2026-03-03')).toBe('2026-03-03')
  })

  it('opens on the first travel day before the trip starts', () => {
    // Day one is only the right answer on the day you created the trip.
    expect(focusDay(journey, '2026-01-01')).toBe('2026-03-02')
  })

  it('opens on the last day once the trip is over', () => {
    expect(focusDay(journey, '2026-06-01')).toBe('2026-03-05')
  })

  it('falls back to day one when nothing is scheduled', () => {
    const plain = buildJourney(input({ startDate: '2026-03-01', endDate: '2026-03-05' }))
    expect(focusDay(plain, '2026-01-01')).toBe('2026-03-01')
  })

  it('has no answer for a trip without dates', () => {
    expect(focusDay(buildJourney(EMPTY), '2026-03-01')).toBeNull()
  })
})

describe('the sentence at the top', () => {
  it('counts the days it has, without inventing a category it does not', () => {
    const journey = buildJourney(
      input({
        startDate: '2026-03-01',
        endDate: '2026-03-03',
        items: [item({ scheduled_date: '2026-03-01' })],
      }),
    )
    const sentence = describeTripJourney(journey)
    expect(sentence).toContain('3 days')
    expect(sentence).toContain('1 with something planned')
    expect(sentence).not.toContain('kept clear')
  })
})
