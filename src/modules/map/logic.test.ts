import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FILTERS,
  applyFilters,
  boundsOf,
  dayRoute,
  daysWithPins,
  fallbackCenter,
  formatDistance,
  googleMapsUrl,
  paddedBounds,
  routeDistanceKm,
  WORLD_CENTER,
} from '@/modules/map/logic'
import type { MapPin } from '@/modules/map/types'

let seq = 0
const pin = (over: Partial<MapPin> = {}): MapPin => ({
  id: `p${++seq}`,
  layer: 'itinerary',
  title: 'Somewhere',
  lat: 38.72,
  lng: -9.14,
  date: '2026-06-02',
  time: null,
  categoryId: null,
  personId: null,
  state: 'idea',
  placeName: null,
  address: null,
  tripId: 't1',
  tripTitle: null,
  ...over,
})

describe('googleMapsUrl', () => {
  it('prefers coordinates — a name alone lands in the wrong city', () => {
    expect(googleMapsUrl({ title: 'Ramiro', lat: 38.72, lng: -9.13 })).toBe(
      'https://www.google.com/maps/search/?api=1&query=38.72,-9.13',
    )
  })

  it('falls back to the name, encoded', () => {
    expect(googleMapsUrl({ title: 'Café A Brasileira', lat: null, lng: null })).toBe(
      'https://www.google.com/maps/search/?api=1&query=Caf%C3%A9%20A%20Brasileira',
    )
  })
})

describe('applyFilters', () => {
  it('hides a layer that is switched off', () => {
    const pins = [pin({ layer: 'itinerary' }), pin({ layer: 'wishlist', date: null })]
    const filters = { ...DEFAULT_FILTERS, layers: { itinerary: false, pool: true, wishlist: true } }
    expect(applyFilters(pins, filters).map((p) => p.layer)).toEqual(['wishlist'])
  })

  it('numbers the pins in order once a single day is selected', () => {
    const pins = [
      pin({ date: '2026-06-02', title: 'first' }),
      pin({ date: '2026-06-02', title: 'second' }),
      pin({ date: '2026-06-03', title: 'other day' }),
    ]
    const numbered = applyFilters(pins, { ...DEFAULT_FILTERS, day: '2026-06-02' })
    expect(numbered.map((p) => [p.title, p.order])).toEqual([
      ['first', 1],
      ['second', 2],
    ])
  })

  it('leaves pins unnumbered when every day is shown', () => {
    expect(applyFilters([pin()], DEFAULT_FILTERS)[0]!.order).toBeUndefined()
  })

  it('filters by person, category and state', () => {
    const wanted = pin({ personId: 'me', categoryId: 'food', state: 'booked' })
    const pins = [wanted, pin({ personId: 'them' }), pin({ categoryId: 'sight' })]

    expect(
      applyFilters(pins, { ...DEFAULT_FILTERS, personId: 'me' }).map((p) => p.id),
    ).toEqual([wanted.id])
    expect(
      applyFilters(pins, { ...DEFAULT_FILTERS, categoryId: 'food' }).map((p) => p.id),
    ).toEqual([wanted.id])
    expect(
      applyFilters(pins, { ...DEFAULT_FILTERS, state: 'booked' }).map((p) => p.id),
    ).toEqual([wanted.id])
  })

  it('drops unscheduled pins from a single-day view', () => {
    const pins = [pin({ date: '2026-06-02' }), pin({ layer: 'pool', date: null })]
    expect(applyFilters(pins, { ...DEFAULT_FILTERS, day: '2026-06-02' })).toHaveLength(1)
  })
})

describe('boundsOf', () => {
  it('is null with nothing to fit', () => {
    expect(boundsOf([])).toBeNull()
  })

  it('spans every pin', () => {
    expect(boundsOf([{ lat: 1, lng: 2 }, { lat: -3, lng: 40 }])).toEqual({
      north: 1,
      south: -3,
      east: 40,
      west: 2,
    })
  })
})

describe('paddedBounds', () => {
  it('gives a single pin a box to sit in rather than a point', () => {
    const padded = paddedBounds({ north: 38.72, south: 38.72, east: -9.14, west: -9.14 })
    expect(padded.north).toBeGreaterThan(padded.south)
    expect(padded.east).toBeGreaterThan(padded.west)
  })

  it('stays inside the world', () => {
    const padded = paddedBounds({ north: 89.9, south: -89.9, east: 179.9, west: -179.9 })
    expect(padded.north).toBeLessThanOrEqual(90)
    expect(padded.south).toBeGreaterThanOrEqual(-90)
    expect(padded.east).toBeLessThanOrEqual(180)
    expect(padded.west).toBeGreaterThanOrEqual(-180)
  })
})

describe('routeDistanceKm', () => {
  it('is zero for a single stop', () => {
    expect(routeDistanceKm([pin()])).toBe(0)
  })

  it('adds up the legs', () => {
    const km = routeDistanceKm([
      pin({ lat: 38.7, lng: -9.14 }),
      pin({ lat: 38.71, lng: -9.14 }),
      pin({ lat: 38.72, lng: -9.14 }),
    ])
    // Two legs of roughly 1.11 km each.
    expect(km).toBeGreaterThan(2)
    expect(km).toBeLessThan(2.5)
  })
})

describe('formatDistance', () => {
  it('uses metres below a kilometre', () => {
    expect(formatDistance(0.42)).toBe('420 m')
  })

  it('keeps one decimal until ten kilometres', () => {
    expect(formatDistance(3.14)).toBe('3.1 km')
    expect(formatDistance(42.4)).toBe('42 km')
  })
})

describe('daysWithPins', () => {
  it('lists each day once, in order', () => {
    const pins = [
      pin({ date: '2026-06-03' }),
      pin({ date: '2026-06-01' }),
      pin({ date: '2026-06-03' }),
      pin({ date: null }),
    ]
    expect(daysWithPins(pins)).toEqual(['2026-06-01', '2026-06-03'])
  })
})

describe('dayRoute', () => {
  it('is empty without a selected day', () => {
    expect(dayRoute([pin()], null)).toEqual([])
  })

  it('only draws scheduled items — the pool has no order', () => {
    const scheduled = pin({ date: '2026-06-02', layer: 'itinerary' })
    const pooled = pin({ date: '2026-06-02', layer: 'pool' })
    expect(dayRoute([scheduled, pooled], '2026-06-02').map((p) => p.id)).toEqual([scheduled.id])
  })
})

describe('fallbackCenter', () => {
  it('opens over the destination when there is one', () => {
    expect(fallbackCenter({ lat: 38.72, lng: -9.14 })).toEqual({ lat: 38.72, lng: -9.14 })
  })

  it('falls back to the world', () => {
    expect(fallbackCenter(null)).toEqual(WORLD_CENTER)
  })
})
