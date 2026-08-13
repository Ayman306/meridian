import { describe, expect, it } from 'vitest'
import { haversineKm, initials, pluralise } from '@/lib/utils'

describe('haversineKm', () => {
  const toronto = { lat: 43.6532, lng: -79.3832 }
  const karachi = { lat: 24.8607, lng: 67.0011 }
  const lisbon = { lat: 38.7223, lng: -9.1393 }

  it('measures a long-haul pair to within a few km', () => {
    expect(haversineKm(toronto, karachi)).toBeCloseTo(11_643, -2)
  })

  it('is symmetric', () => {
    expect(haversineKm(toronto, lisbon)).toBeCloseTo(haversineKm(lisbon, toronto), 6)
  })

  it('is zero for the same point', () => {
    expect(haversineKm(toronto, toronto)).toBe(0)
  })

  it('handles antipodal points without NaN from float drift', () => {
    expect(haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 180 })).toBeCloseTo(20_015, -2)
  })
})

describe('display helpers', () => {
  it('builds initials from up to two words', () => {
    expect(initials('Sam Rivera')).toBe('SR')
    expect(initials('Sam')).toBe('S')
    expect(initials('  ')).toBe('?')
    expect(initials(null)).toBe('?')
  })

  it('pluralises', () => {
    expect(pluralise(1, 'night')).toBe('1 night')
    expect(pluralise(4, 'night')).toBe('4 nights')
    expect(pluralise(0, 'night')).toBe('0 nights')
  })
})
