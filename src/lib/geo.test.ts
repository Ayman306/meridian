import { describe, expect, it } from 'vitest'
import {
  bearing,
  crossTrackDistanceKm,
  destinationPoint,
  downsampleByTime,
  greatCirclePoints,
  interpolateGreatCircle,
  normaliseLongitude,
  splitAtAntimeridian,
} from '@/lib/geo'
import { haversineKm } from '@/lib/utils'

const LHR = { lat: 51.47, lng: -0.4543 }
const JFK = { lat: 40.6413, lng: -73.7781 }
const NRT = { lat: 35.7647, lng: 140.3864 }
const LAX = { lat: 33.9416, lng: -118.4085 }

describe('interpolateGreatCircle', () => {
  it('returns the endpoints at 0 and 1', () => {
    expect(interpolateGreatCircle(LHR, JFK, 0).lat).toBeCloseTo(LHR.lat, 4)
    expect(interpolateGreatCircle(LHR, JFK, 1).lng).toBeCloseTo(JFK.lng, 4)
  })

  it('bulges north of the straight line across the Atlantic', () => {
    // The whole reason for great circles: the midpoint of London → New York
    // is well north of the average of the two latitudes.
    const midpoint = interpolateGreatCircle(LHR, JFK, 0.5)
    const naiveAverage = (LHR.lat + JFK.lat) / 2
    expect(midpoint.lat).toBeGreaterThan(naiveAverage + 1)
  })

  it('survives two identical points instead of dividing by zero', () => {
    expect(interpolateGreatCircle(LHR, LHR, 0.5)).toEqual({ lat: LHR.lat, lng: LHR.lng })
  })

  it('splits the distance evenly at the midpoint', () => {
    const midpoint = interpolateGreatCircle(LHR, JFK, 0.5)
    const first = haversineKm(LHR, midpoint)
    const second = haversineKm(midpoint, JFK)
    expect(Math.abs(first - second)).toBeLessThan(1)
  })
})

describe('greatCirclePoints', () => {
  it('returns steps + 1 points, ending where it should', () => {
    const points = greatCirclePoints(LHR, JFK, 10)
    expect(points).toHaveLength(11)
    expect(points[10]!.lat).toBeCloseTo(JFK.lat, 4)
  })
})

describe('splitAtAntimeridian', () => {
  it('leaves an ordinary route in one piece', () => {
    expect(splitAtAntimeridian(greatCirclePoints(LHR, JFK, 40))).toHaveLength(1)
  })

  it('splits Tokyo to Los Angeles into two segments', () => {
    // The spec asks for this route by name. Unsplit, Leaflet draws it back
    // across Asia and Europe — the long way round the world.
    const segments = splitAtAntimeridian(greatCirclePoints(NRT, LAX, 100))
    expect(segments).toHaveLength(2)
    expect(segments[0]![segments[0]!.length - 1]!.lng).toBeCloseTo(180, 6)
    expect(segments[1]![0]!.lng).toBeCloseTo(-180, 6)
  })

  it('meets at the same latitude on both sides of the dateline', () => {
    const segments = splitAtAntimeridian(greatCirclePoints(NRT, LAX, 100))
    const end = segments[0]![segments[0]!.length - 1]!
    const start = segments[1]![0]!
    expect(Math.abs(end.lat - start.lat)).toBeLessThan(0.001)
  })

  it('handles a westbound crossing too', () => {
    const segments = splitAtAntimeridian(greatCirclePoints(LAX, NRT, 100))
    expect(segments).toHaveLength(2)
    expect(segments[0]![segments[0]!.length - 1]!.lng).toBeCloseTo(-180, 6)
  })

  it('copes with a degenerate path', () => {
    expect(splitAtAntimeridian([])).toEqual([])
    expect(splitAtAntimeridian([LHR])).toEqual([[LHR]])
  })
})

describe('bearing', () => {
  it('is roughly west from London to New York', () => {
    const heading = bearing(LHR, JFK)
    expect(heading).toBeGreaterThan(250)
    expect(heading).toBeLessThan(300)
  })

  it('is due north for a point directly above', () => {
    expect(bearing({ lat: 0, lng: 0 }, { lat: 10, lng: 0 })).toBeCloseTo(0, 5)
  })
})

describe('destinationPoint', () => {
  it('lands the right distance away', () => {
    const to = destinationPoint(LHR, 90, 100)
    expect(haversineKm(LHR, to)).toBeCloseTo(100, 0)
  })

  it('wraps rather than producing a longitude past 180', () => {
    const to = destinationPoint({ lat: 0, lng: 179 }, 90, 500)
    expect(to.lng).toBeLessThan(0)
    expect(to.lng).toBeGreaterThan(-180)
  })

  it('is the identity for zero distance', () => {
    const to = destinationPoint(LHR, 42, 0)
    expect(to.lat).toBeCloseTo(LHR.lat, 6)
  })
})

describe('normaliseLongitude', () => {
  it('wraps out-of-range values into −180..180', () => {
    expect(normaliseLongitude(190)).toBeCloseTo(-170)
    expect(normaliseLongitude(-190)).toBeCloseTo(170)
    expect(normaliseLongitude(45)).toBe(45)
  })
})

describe('crossTrackDistanceKm', () => {
  it('is near zero on the route', () => {
    const onRoute = interpolateGreatCircle(LHR, JFK, 0.4)
    expect(crossTrackDistanceKm(onRoute, LHR, JFK)).toBeLessThan(1)
  })

  it('grows for a point well off the corridor', () => {
    // Reykjavik is a long way north of the London–New York track.
    const off = { lat: 64.13, lng: -21.94 }
    expect(crossTrackDistanceKm(off, LHR, JFK)).toBeGreaterThan(200)
  })
})

describe('downsampleByTime', () => {
  const at = (minutes: number) => ({
    recorded_at: new Date(Date.UTC(2026, 0, 1, 0, minutes)).toISOString(),
  })

  it('thins a dense trail', () => {
    const dense = Array.from({ length: 20 }, (_, i) => at(i))
    const kept = downsampleByTime(dense, 120_000)
    expect(kept.length).toBeLessThan(dense.length)
    expect(kept.length).toBeGreaterThan(5)
  })

  it('always keeps the newest fix — the marker sits on it', () => {
    const dense = Array.from({ length: 20 }, (_, i) => at(i))
    const kept = downsampleByTime(dense, 120_000)
    expect(kept[kept.length - 1]).toBe(dense[dense.length - 1])
  })

  it('leaves a sparse trail alone', () => {
    const sparse = [at(0), at(10), at(20)]
    expect(downsampleByTime(sparse, 120_000)).toHaveLength(3)
  })
})
