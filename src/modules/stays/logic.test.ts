/**
 * Every test here is really one test: `check_out` is exclusive.
 *
 * That single rule decides which hotel a night belongs to, whether a trip has
 * an unbooked gap, and whether two bookings clash. Get it wrong and the app
 * shows somebody a room they checked out of that morning — a mistake that
 * looks correct on screen and is only discovered at a locked door.
 */
import { describe, expect, it } from 'vitest'
import type { Accommodation } from './types'
import {
  describeStay,
  isCheckoutDay,
  nightsAt,
  overlappingStays,
  sortStays,
  stayOn,
  uncoveredNights,
} from './logic'

function stay(patch: Partial<Accommodation>): Accommodation {
  return {
    id: 'a',
    couple_id: 'c',
    trip_id: 't',
    name: 'Pensão Alfama',
    kind: 'hotel',
    check_in: '2026-06-01',
    check_out: '2026-06-04',
    address: null,
    city: 'Lisbon',
    country_code: 'PT',
    lat: 38.71,
    lng: -9.13,
    maps_url: null,
    booking_ref: null,
    url: null,
    phone: null,
    notes: null,
    created_by: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    deleted_at: null,
    ...patch,
  }
}

describe('nights, not days', () => {
  it('counts the nights between the two dates', () => {
    expect(nightsAt({ check_in: '2026-06-01', check_out: '2026-06-04' })).toBe(3)
    expect(nightsAt({ check_in: '2026-06-01', check_out: '2026-06-02' })).toBe(1)
  })

  it('has no answer when either end is unknown', () => {
    expect(nightsAt({ check_in: '2026-06-01', check_out: null })).toBeNull()
    expect(nightsAt({ check_in: null, check_out: '2026-06-04' })).toBeNull()
  })
})

describe('which stay a night belongs to', () => {
  const stays = [
    stay({ id: 'first', check_in: '2026-06-01', check_out: '2026-06-04' }),
    stay({ id: 'second', name: 'Casa Porto', check_in: '2026-06-04', check_out: '2026-06-07' }),
  ]

  it('covers the check-in night', () => {
    expect(stayOn('2026-06-01', stays)?.id).toBe('first')
  })

  it('gives the check-out morning to the next booking, not the one being left', () => {
    // The whole file in one assertion. On the 4th they move; that night they
    // are at the second place, and the first has nothing to say about it.
    expect(stayOn('2026-06-04', stays)?.id).toBe('second')
  })

  it('covers the last night of a stay', () => {
    expect(stayOn('2026-06-03', stays)?.id).toBe('first')
    expect(stayOn('2026-06-06', stays)?.id).toBe('second')
  })

  it('covers nothing after the last check-out', () => {
    expect(stayOn('2026-06-07', stays)).toBeNull()
    expect(stayOn('2026-05-31', stays)).toBeNull()
  })

  it('treats a stay with no check-out as still running', () => {
    // An open-ended booking is a real thing — a flat taken until further
    // notice. Reading it as a zero-night stay would blank the map.
    const openEnded = [stay({ check_in: '2026-06-01', check_out: null })]
    expect(stayOn('2026-09-01', openEnded)).not.toBeNull()
  })

  it('ignores a stay with no dates at all', () => {
    expect(stayOn('2026-06-01', [stay({ check_in: null, check_out: null })])).toBeNull()
  })
})

describe('the morning they have to be out', () => {
  it('is the check-out date and no other', () => {
    const stays = [stay({ check_in: '2026-06-01', check_out: '2026-06-04' })]
    expect(isCheckoutDay('2026-06-04', stays)).toBe(true)
    expect(isCheckoutDay('2026-06-03', stays)).toBe(false)
  })
})

describe('nights with nowhere booked', () => {
  it('does not count the departure day as a night', () => {
    // A trip from the 1st to the 5th is four nights. Counting the 5th would
    // report a phantom gap on every fully-booked trip there has ever been.
    const covering = [stay({ check_in: '2026-06-01', check_out: '2026-06-05' })]
    expect(uncoveredNights('2026-06-01', '2026-06-05', covering)).toEqual([])
  })

  it('reports a run of nights as one gap, not several', () => {
    const gaps = uncoveredNights('2026-06-01', '2026-06-06', [
      stay({ check_in: '2026-06-01', check_out: '2026-06-03' }),
    ])
    expect(gaps).toEqual([{ from: '2026-06-03', to: '2026-06-06', nights: 3 }])
  })

  it('finds a gap in the middle', () => {
    const gaps = uncoveredNights('2026-06-01', '2026-06-06', [
      stay({ id: 'a', check_in: '2026-06-01', check_out: '2026-06-02' }),
      stay({ id: 'b', check_in: '2026-06-04', check_out: '2026-06-06' }),
    ])
    expect(gaps).toEqual([{ from: '2026-06-02', to: '2026-06-04', nights: 2 }])
  })

  it('reports the whole trip when nothing is booked', () => {
    expect(uncoveredNights('2026-06-01', '2026-06-04', [])).toEqual([
      { from: '2026-06-01', to: '2026-06-04', nights: 3 },
    ])
  })

  it('says nothing about a trip with no dates', () => {
    expect(uncoveredNights(null, '2026-06-04', [])).toEqual([])
    expect(uncoveredNights('2026-06-01', null, [])).toEqual([])
  })

  it('says nothing about a day trip, which has no nights to book', () => {
    expect(uncoveredNights('2026-06-01', '2026-06-01', [])).toEqual([])
  })
})

describe('two bookings on one night', () => {
  it('finds the clash and says how many nights it covers', () => {
    const overlaps = overlappingStays([
      stay({ id: 'a', check_in: '2026-06-01', check_out: '2026-06-05' }),
      stay({ id: 'b', check_in: '2026-06-03', check_out: '2026-06-07' }),
    ])
    expect(overlaps).toHaveLength(1)
    expect(overlaps[0]).toMatchObject({ from: '2026-06-03', nights: 2 })
  })

  it('does not call a same-day handover a clash', () => {
    // Checking out of one and into another on the 4th is the normal way to
    // move hotels, and flagging it would make the warning useless.
    expect(
      overlappingStays([
        stay({ id: 'a', check_in: '2026-06-01', check_out: '2026-06-04' }),
        stay({ id: 'b', check_in: '2026-06-04', check_out: '2026-06-07' }),
      ]),
    ).toEqual([])
  })

  it('ignores anything without both dates', () => {
    expect(
      overlappingStays([
        stay({ id: 'a', check_in: '2026-06-01', check_out: null }),
        stay({ id: 'b', check_in: '2026-06-01', check_out: '2026-06-07' }),
      ]),
    ).toEqual([])
  })
})

describe('ordering and description', () => {
  it('runs in trip order, with undated stays last', () => {
    const ordered = sortStays([
      stay({ id: 'late', check_in: '2026-06-10' }),
      stay({ id: 'undated', check_in: null }),
      stay({ id: 'early', check_in: '2026-06-01' }),
    ])
    expect(ordered.map((s) => s.id)).toEqual(['early', 'late', 'undated'])
  })

  it('says what is known and pads nothing', () => {
    expect(describeStay(stay({}))).toBe('Hotel · 3 nights · Lisbon')
    expect(describeStay(stay({ kind: 'family', check_out: null, city: null }))).toBe(
      'Family · from 2026-06-01',
    )
    expect(describeStay(stay({ check_out: '2026-06-02' }))).toContain('1 night')
  })
})
