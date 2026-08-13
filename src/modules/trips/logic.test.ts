import { describe, expect, it } from 'vitest'
import {
  countdownDays,
  days,
  diffTripDays,
  formatTripDates,
  groupTrips,
  isLongStay,
  isStalePlanning,
  nextDayType,
  nights,
  overlappingTrips,
  snapStartToPrecision,
  togetherWindow,
  tripGroup,
} from '@/modules/trips/logic'
import type { Trip, TripTraveler } from '@/modules/trips/types'

const trip = (over: Partial<Trip> = {}): Trip => ({
  id: 't1',
  couple_id: 'c1',
  title: 'Lisbon',
  start_date: null,
  end_date: null,
  date_precision: 'unknown',
  is_open_ended: false,
  timezone: null,
  status_id: null,
  cover_media_id: null,
  notes: null,
  custom: {},
  created_by: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  deleted_at: null,
  ...over,
})

const traveler = (over: Partial<TripTraveler> = {}): TripTraveler => ({
  trip_id: 't1',
  user_id: 'u1',
  origin_airport: null,
  arrival_date: null,
  departure_date: null,
  notes: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...over,
})

describe('duration', () => {
  it('counts nights and days separately', () => {
    const t = trip({ start_date: '2026-11-12', end_date: '2026-11-16' })
    expect(nights(t)).toBe(4)
    expect(days(t)).toBe(5)
  })

  it('is null when we cannot know', () => {
    expect(nights(trip())).toBeNull()
    expect(nights(trip({ start_date: '2026-11-12' }))).toBeNull()
    expect(days(trip())).toBeNull()
  })

  it('activates long-stay mode at 6 nights, not 5', () => {
    expect(isLongStay(trip({ start_date: '2026-11-01', end_date: '2026-11-06' }))).toBe(false)
    expect(isLongStay(trip({ start_date: '2026-11-01', end_date: '2026-11-07' }))).toBe(true)
  })

  it('does not claim long stay for a trip with no dates', () => {
    expect(isLongStay(trip())).toBe(false)
  })

  it('counts correctly across a DST boundary and a month end', () => {
    expect(nights(trip({ start_date: '2026-03-07', end_date: '2026-03-09' }))).toBe(2)
    expect(nights(trip({ start_date: '2026-01-28', end_date: '2026-02-03' }))).toBe(6)
  })
})

describe('date precision display', () => {
  const today = '2026-06-15'

  it('renders each precision the way the spec says', () => {
    expect(
      formatTripDates(trip({ start_date: '2026-11-12', end_date: '2026-11-16', date_precision: 'exact' })),
    ).toBe('Nov 12 – Nov 16, 2026')
    expect(formatTripDates(trip({ start_date: '2026-11-01', date_precision: 'month' }))).toBe(
      'November 2026',
    )
    expect(formatTripDates(trip({ start_date: '2026-03-01', date_precision: 'season' }))).toBe(
      'Spring 2026',
    )
    expect(formatTripDates(trip({ start_date: '2026-01-01', date_precision: 'year' }))).toBe('2026')
    expect(formatTripDates(trip())).toBe('Dates TBD')
  })

  it('spells out both years when a trip crosses new year', () => {
    expect(
      formatTripDates(trip({ start_date: '2026-12-28', end_date: '2027-01-04', date_precision: 'exact' })),
    ).toBe('Dec 28, 2026 – Jan 4, 2027')
  })

  it('marks an open-ended trip', () => {
    expect(
      formatTripDates(trip({ start_date: '2026-06-01', date_precision: 'exact', is_open_ended: true })),
    ).toBe('Jun 1, 2026 onwards')
  })

  it('only counts down for exact dates', () => {
    // Vague dates must never produce "247 days".
    expect(countdownDays(trip({ start_date: '2099-01-01', date_precision: 'season' }), today)).toBeNull()
    expect(countdownDays(trip({ start_date: '2099-01-01', date_precision: 'month' }), today)).toBeNull()
    expect(
      countdownDays(trip({ start_date: '2099-01-01', date_precision: 'exact' }), today),
    ).toBeGreaterThan(0)
  })

  it('does not count down to a date that has passed', () => {
    expect(countdownDays(trip({ start_date: '2020-01-01', date_precision: 'exact' }), today)).toBeNull()
  })

  it('snaps a stored date to the start of its period', () => {
    expect(snapStartToPrecision('2026-11-17', 'month')).toBe('2026-11-01')
    expect(snapStartToPrecision('2026-11-17', 'year')).toBe('2026-01-01')
    expect(snapStartToPrecision('2026-04-17', 'season')).toBe('2026-03-01')
    expect(snapStartToPrecision('2026-01-17', 'season')).toBe('2025-12-01')
    expect(snapStartToPrecision('2026-11-17', 'exact')).toBe('2026-11-17')
  })
})

describe('together window', () => {
  it('intersects the two travelers', () => {
    const w = togetherWindow(trip({ start_date: '2026-06-01', end_date: '2026-06-20' }), [
      traveler({ user_id: 'a', arrival_date: '2026-06-03', departure_date: '2026-06-18' }),
      traveler({ user_id: 'b', arrival_date: '2026-06-05', departure_date: '2026-06-14' }),
    ])
    expect(w.start).toBe('2026-06-05')
    expect(w.end).toBe('2026-06-14')
    expect(w.nights).toBe(9)
    expect(w.overlaps).toBe(true)
  })

  it('falls back to the trip dates for a traveler who set none', () => {
    const w = togetherWindow(trip({ start_date: '2026-06-01', end_date: '2026-06-10' }), [
      traveler({ user_id: 'a' }),
      traveler({ user_id: 'b', arrival_date: '2026-06-04' }),
    ])
    expect(w.start).toBe('2026-06-04')
    expect(w.end).toBe('2026-06-10')
    expect(w.nights).toBe(6)
  })

  it('flags a non-overlap rather than clamping it away', () => {
    const w = togetherWindow(trip({ start_date: '2026-06-01', end_date: '2026-06-30' }), [
      traveler({ user_id: 'a', arrival_date: '2026-06-01', departure_date: '2026-06-05' }),
      traveler({ user_id: 'b', arrival_date: '2026-06-10', departure_date: '2026-06-20' }),
    ])
    expect(w.overlaps).toBe(false)
    expect(w.nights).toBe(0)
  })

  it('is incomplete with one traveler or no dates', () => {
    expect(togetherWindow(trip(), [traveler()]).incomplete).toBe(true)
    expect(
      togetherWindow(trip(), [traveler({ user_id: 'a' }), traveler({ user_id: 'b' })]).incomplete,
    ).toBe(true)
  })
})

describe('grouping', () => {
  const today = '2026-06-15'

  it('places a trip in the right group', () => {
    expect(tripGroup(trip({ start_date: '2026-06-10', end_date: '2026-06-20' }), today)).toBe('active')
    expect(tripGroup(trip({ start_date: '2026-08-01', end_date: '2026-08-10' }), today)).toBe('upcoming')
    expect(tripGroup(trip({ start_date: '2026-01-01', end_date: '2026-01-10' }), today)).toBe('past')
    expect(tripGroup(trip(), today)).toBe('planning')
  })

  it('treats a single-day trip on today as active', () => {
    expect(tripGroup(trip({ start_date: today }), today)).toBe('active')
  })

  it('never lets an open-ended trip fall into the past', () => {
    expect(
      tripGroup(trip({ start_date: '2026-01-01', is_open_ended: true }), today),
    ).toBe('active')
  })

  it('sorts each group by what you would reach for first', () => {
    const groups = groupTrips(
      [
        trip({ id: 'later', start_date: '2026-09-01', end_date: '2026-09-05' }),
        trip({ id: 'sooner', start_date: '2026-07-01', end_date: '2026-07-05' }),
        trip({ id: 'old-idea', updated_at: '2026-01-01T00:00:00Z' }),
        trip({ id: 'fresh-idea', updated_at: '2026-06-01T00:00:00Z' }),
        trip({ id: 'ancient', start_date: '2025-01-01', end_date: '2025-01-05' }),
        trip({ id: 'recent-past', start_date: '2026-02-01', end_date: '2026-02-05' }),
      ],
      today,
    )
    expect(groups.upcoming.map((t) => t.id)).toEqual(['sooner', 'later'])
    expect(groups.planning.map((t) => t.id)).toEqual(['fresh-idea', 'old-idea'])
    expect(groups.past.map((t) => t.id)).toEqual(['recent-past', 'ancient'])
  })
})

describe('day scaffolding', () => {
  it('adds exactly the new days when a trip is extended', () => {
    const existing = ['2026-06-01', '2026-06-02', '2026-06-03']
    const diff = diffTripDays(existing, '2026-06-01', '2026-06-05')
    expect(diff.toAdd).toEqual(['2026-06-04', '2026-06-05'])
    expect(diff.toRemove).toEqual([])
  })

  it('reports what shortening would remove, rather than removing it', () => {
    const existing = ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04']
    const diff = diffTripDays(existing, '2026-06-01', '2026-06-02')
    expect(diff.toRemove).toEqual(['2026-06-03', '2026-06-04'])
    expect(diff.toAdd).toEqual([])
  })

  it('handles a shifted range that both adds and removes', () => {
    const diff = diffTripDays(['2026-06-01', '2026-06-02'], '2026-06-02', '2026-06-03')
    expect(diff.toAdd).toEqual(['2026-06-03'])
    expect(diff.toRemove).toEqual(['2026-06-01'])
  })

  it('drops every day when the dates are cleared', () => {
    const diff = diffTripDays(['2026-06-01', '2026-06-02'], null, null)
    expect(diff.toRemove).toHaveLength(2)
    expect(diff.toAdd).toEqual([])
  })

  it('gives an open-ended trip a rolling 31-day horizon', () => {
    const diff = diffTripDays([], '2026-06-01', null, true)
    expect(diff.toAdd).toHaveLength(31)
    expect(diff.toAdd.at(-1)).toBe('2026-07-01')
  })

  it('generates a 31-day trip without gaps', () => {
    const diff = diffTripDays([], '2026-07-01', '2026-07-31')
    expect(diff.toAdd).toHaveLength(31)
  })
})

describe('day types', () => {
  it('promotes an open day to planned once it has an item', () => {
    expect(nextDayType('open', { itemCount: 1 })).toBe('planned')
  })

  it('never demotes a manually set type', () => {
    // Someone who marked a day "rest" meant it.
    expect(nextDayType('rest', { itemCount: 3 })).toBe('rest')
    expect(nextDayType('work', { itemCount: 3 })).toBe('work')
  })

  it('lets a flight override everything', () => {
    expect(nextDayType('rest', { hasFlight: true })).toBe('travel')
  })

  it('leaves an empty open day alone', () => {
    expect(nextDayType('open', { itemCount: 0 })).toBe('open')
  })
})

describe('overlaps and staleness', () => {
  it('finds overlapping trips, including nested ones', () => {
    const long = trip({ id: 'long', start_date: '2026-06-01', end_date: '2026-06-30' })
    const nested = trip({ id: 'nested', start_date: '2026-06-10', end_date: '2026-06-12' })
    const apart = trip({ id: 'apart', start_date: '2026-08-01', end_date: '2026-08-05' })
    expect(overlappingTrips(long, [nested, apart]).map((t) => t.id)).toEqual(['nested'])
  })

  it('ignores itself and trips with no dates', () => {
    const t = trip({ id: 'a', start_date: '2026-06-01', end_date: '2026-06-30' })
    expect(overlappingTrips(t, [t, trip({ id: 'b' })])).toEqual([])
  })

  it('nudges a past trip still marked as planning', () => {
    const past = trip({ start_date: '2026-01-01', end_date: '2026-01-05' })
    expect(isStalePlanning(past, '2026-06-15', 'Planning')).toBe(true)
    expect(isStalePlanning(past, '2026-06-15', 'Completed')).toBe(false)
    expect(isStalePlanning(trip(), '2026-06-15', 'Planning')).toBe(false)
  })
})
