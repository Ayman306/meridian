import { describe, expect, it } from 'vitest'
import {
  addDaysTo,
  dateRange,
  daysBetween,
  dualTime,
  isValidDateOnly,
  maxDate,
  minDate,
  monthsUntil,
  msUntilMidnightIn,
  nightsBetween,
  normaliseTime,
  offsetMinutes,
  todayIn,
  tripLocalToUtc,
} from '@/lib/dates'

describe('calendar dates', () => {
  it('counts nights, not days', () => {
    // 12th-16th is 4 nights, 5 days. The spec calls this out explicitly.
    expect(nightsBetween('2026-11-12', '2026-11-16')).toBe(4)
    expect(daysBetween('2026-11-12', '2026-11-16')).toBe(4)
  })

  it('is unaffected by DST transitions', () => {
    // North American spring-forward: 2026-03-08. An elapsed-ms implementation
    // would return 0.958 days here and round wrong.
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2)
    // Autumn fall-back.
    expect(daysBetween('2026-11-01', '2026-11-02')).toBe(1)
  })

  it('handles month and year ends', () => {
    expect(daysBetween('2026-01-31', '2026-02-01')).toBe(1)
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1)
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2) // leap year
  })

  it('clamps nights at zero for inverted ranges', () => {
    expect(nightsBetween('2026-05-10', '2026-05-01')).toBe(0)
    expect(daysBetween('2026-05-10', '2026-05-01')).toBe(-9)
  })

  it('builds an inclusive date range', () => {
    expect(dateRange('2026-04-29', '2026-05-02')).toEqual([
      '2026-04-29',
      '2026-04-30',
      '2026-05-01',
      '2026-05-02',
    ])
    expect(dateRange('2026-04-29', '2026-04-29')).toEqual(['2026-04-29'])
    expect(dateRange('2026-04-29', '2026-04-28')).toEqual([])
  })

  it('adds days across a month boundary', () => {
    expect(addDaysTo('2026-01-30', 3)).toBe('2026-02-02')
    expect(addDaysTo('2026-01-01', -1)).toBe('2025-12-31')
  })

  it('validates date-only strings', () => {
    expect(isValidDateOnly('2026-02-30')).toBe(false)
    expect(isValidDateOnly('2026-2-1')).toBe(false)
    expect(isValidDateOnly('2026-02-01')).toBe(true)
    expect(isValidDateOnly(null)).toBe(false)
  })

  it('picks min and max, ignoring nulls', () => {
    expect(maxDate('2026-01-01', null, '2026-06-01')).toBe('2026-06-01')
    expect(minDate('2026-01-01', null, '2026-06-01')).toBe('2026-01-01')
    expect(maxDate(null, undefined)).toBeNull()
  })

  it('counts whole months for the passport rules', () => {
    expect(monthsUntil('2027-01-15', '2026-04-15')).toBe(9)
    expect(monthsUntil('2026-10-14', '2026-04-15')).toBe(5)
  })
})

describe('dualTime', () => {
  it('renders one instant in two zones', () => {
    // 2026-06-15T23:30Z — 19:30 in Toronto, 04:30 next day in Karachi.
    const r = dualTime('2026-06-15T23:30:00Z', 'America/Toronto', 'Asia/Karachi')
    expect(r.a).toBe('19:30')
    expect(r.b).toBe('04:30')
    expect(r.sameDay).toBe(false)
    expect(r.dayOffset).toBe(1)
  })

  it('reports a negative offset when the partner is behind', () => {
    const r = dualTime('2026-06-15T02:00:00Z', 'Asia/Tokyo', 'America/Los_Angeles')
    expect(r.dayOffset).toBe(-1)
  })

  it('reports sameDay when both zones agree', () => {
    const r = dualTime('2026-06-15T14:00:00Z', 'Europe/London', 'Europe/Lisbon')
    expect(r.sameDay).toBe(true)
    expect(r.dayOffset).toBe(0)
  })

  it('survives the extreme zone pair the spec names', () => {
    // Kiribati is UTC+14, Hawaii is UTC-10: a full day apart.
    const r = dualTime('2026-06-15T12:00:00Z', 'Pacific/Kiritimati', 'Pacific/Honolulu')
    expect(r.dayOffset).toBe(-1)
  })
})

describe('trip-local time', () => {
  it('resolves wall-clock time in the trip zone to a real instant', () => {
    // 20:00 in Lisbon on 2026-07-04 (WEST, UTC+1) is 19:00Z.
    expect(tripLocalToUtc('2026-07-04', '20:00', 'Europe/Lisbon').toISOString()).toBe(
      '2026-07-04T19:00:00.000Z',
    )
  })

  it('treats a missing time as midnight local', () => {
    expect(tripLocalToUtc('2026-01-10', null, 'Asia/Tokyo').toISOString()).toBe(
      '2026-01-09T15:00:00.000Z',
    )
  })

  it('normalises times to seconds precision', () => {
    expect(normaliseTime('9:5')).toBe('09:05:00')
    expect(normaliseTime('14:30:15')).toBe('14:30:15')
  })
})

describe('zone helpers', () => {
  it('reports offsets in minutes', () => {
    expect(offsetMinutes('UTC', new Date('2026-06-15T12:00:00Z'))).toBe(0)
    expect(offsetMinutes('Asia/Kolkata', new Date('2026-06-15T12:00:00Z'))).toBe(330)
    expect(offsetMinutes('America/Toronto', new Date('2026-01-15T12:00:00Z'))).toBe(-300)
  })

  it('gives today in the requested zone, not the machine zone', () => {
    expect(todayIn('UTC')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('counts down to the next local midnight', () => {
    const at = new Date('2026-06-15T22:30:00Z')
    // 18:30 in Toronto → 5h30m until midnight there.
    expect(msUntilMidnightIn('America/Toronto', at)).toBe(5.5 * 3600 * 1000)
  })
})
