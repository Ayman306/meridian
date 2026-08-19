import { describe, expect, it } from 'vitest'
import {
  buildPlan,
  checkPacing,
  clashesWithWork,
  dayDensity,
  dayNumber,
  dayWarnings,
  daysWithItems,
  emptyDayTreatment,
  formatItemTime,
  planDays,
  sortDayItems,
  toMinutes,
  workBand,
} from '@/modules/itinerary/logic'
import type { ItineraryItem } from '@/modules/itinerary/types'

let seq = 0
const item = (over: Partial<ItineraryItem> = {}): ItineraryItem => ({
  id: `i${++seq}`,
  couple_id: 'c1',
  trip_id: 't1',
  title: 'Something',
  scheduled_date: null,
  start_time: null,
  end_time: null,
  duration_minutes: null,
  destination_id: null,
  place_name: null,
  lat: null,
  lng: null,
  address: null,
  maps_url: null,
  category_id: null,
  notes: null,
  url: null,
  cost_estimate: null,
  currency: null,
  proposed_by: null,
  source: 'manual',
  state: 'idea',
  sort_key: 'a0',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  deleted_at: null,
  ...over,
})

describe('the two empty states', () => {
  it('offers an action on a short trip', () => {
    expect(emptyDayTreatment(1)).toBe('empty')
    expect(emptyDayTreatment(5)).toBe('empty')
  })

  it('offers nothing at all on a long stay', () => {
    // The single most important behavioural rule in the module: past five
    // nights, a blank day is the goal, not a gap.
    expect(emptyDayTreatment(6)).toBe('restful')
    expect(emptyDayTreatment(30)).toBe('restful')
  })

  it('falls back to the actionable state when the length is unknown', () => {
    expect(emptyDayTreatment(null)).toBe('empty')
  })
})

describe('ordering within a day', () => {
  it('puts timed items first, in clock order', () => {
    const sorted = sortDayItems([
      item({ id: 'evening', start_time: '20:00:00' }),
      item({ id: 'morning', start_time: '09:00:00' }),
      item({ id: 'noon', start_time: '12:30:00' }),
    ])
    expect(sorted.map((i) => i.id)).toEqual(['morning', 'noon', 'evening'])
  })

  it('floats untimed items after timed ones, in manual order', () => {
    const sorted = sortDayItems([
      item({ id: 'loose-b', sort_key: 'a2' }),
      item({ id: 'timed', start_time: '15:00:00' }),
      item({ id: 'loose-a', sort_key: 'a1' }),
    ])
    expect(sorted.map((i) => i.id)).toEqual(['timed', 'loose-a', 'loose-b'])
  })

  it('breaks a time tie by manual order', () => {
    const sorted = sortDayItems([
      item({ id: 'second', start_time: '09:00:00', sort_key: 'a2' }),
      item({ id: 'first', start_time: '09:00:00', sort_key: 'a1' }),
    ])
    expect(sorted.map((i) => i.id)).toEqual(['first', 'second'])
  })
})

describe('buildPlan', () => {
  it('splits the pool from the scheduled days', () => {
    const plan = buildPlan(
      [
        item({ id: 'idea', sort_key: 'a1' }),
        item({ id: 'day1', scheduled_date: '2026-06-02', start_time: '10:00:00' }),
        item({ id: 'day2', scheduled_date: '2026-06-03' }),
      ],
      '2026-06-01',
      '2026-06-05',
    )
    expect(plan.pool.map((i) => i.id)).toEqual(['idea'])
    expect(plan.byDate['2026-06-02']?.map((i) => i.id)).toEqual(['day1'])
    expect(plan.byDate['2026-06-03']?.map((i) => i.id)).toEqual(['day2'])
    expect(plan.orphaned).toEqual([])
  })

  it('strands items left outside the trip range by a date change', () => {
    const plan = buildPlan(
      [
        item({ id: 'before', scheduled_date: '2026-05-30' }),
        item({ id: 'inside', scheduled_date: '2026-06-02' }),
        item({ id: 'after', scheduled_date: '2026-06-20' }),
      ],
      '2026-06-01',
      '2026-06-05',
    )
    expect(plan.orphaned.map((i) => i.id)).toEqual(['before', 'after'])
    expect(plan.byDate['2026-06-02']).toHaveLength(1)
  })

  it('treats every scheduled item as valid when the trip has no dates', () => {
    const plan = buildPlan([item({ id: 'x', scheduled_date: '2026-06-02' })], null, null)
    expect(plan.orphaned).toEqual([])
    expect(plan.byDate['2026-06-02']).toHaveLength(1)
  })

  it('ignores soft-deleted items', () => {
    const plan = buildPlan(
      [item({ id: 'gone', deleted_at: '2026-01-02T00:00:00Z' }), item({ id: 'here' })],
      null,
      null,
    )
    expect(plan.pool.map((i) => i.id)).toEqual(['here'])
  })

  it('sorts the pool by manual order', () => {
    const plan = buildPlan(
      [item({ id: 'b', sort_key: 'a2' }), item({ id: 'a', sort_key: 'a1' })],
      null,
      null,
    )
    expect(plan.pool.map((i) => i.id)).toEqual(['a', 'b'])
  })

  it('handles an open-ended trip, where anything after the start is fine', () => {
    const plan = buildPlan([item({ id: 'far', scheduled_date: '2027-01-01' })], '2026-06-01', null)
    expect(plan.orphaned).toEqual([])
  })
})

describe('planDays', () => {
  it('is empty without a start date, so no scheduling UI renders', () => {
    expect(planDays(null, null)).toEqual([])
    expect(planDays(null, '2026-06-05')).toEqual([])
  })

  it('covers the whole range inclusively', () => {
    expect(planDays('2026-06-01', '2026-06-03')).toEqual(['2026-06-01', '2026-06-02', '2026-06-03'])
  })

  it('is a single day when there is no end', () => {
    expect(planDays('2026-06-01', null)).toEqual(['2026-06-01'])
  })
})

describe('conflict detection', () => {
  it('flags two timed items that overlap', () => {
    const warnings = dayWarnings([
      item({ id: 'lunch', start_time: '12:00:00', end_time: '14:00:00' }),
      item({ id: 'tour', start_time: '13:00:00' }),
    ])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({ kind: 'overlap', itemId: 'tour' })
  })

  it('uses duration when there is no end time', () => {
    const warnings = dayWarnings([
      item({ id: 'a', start_time: '12:00:00', duration_minutes: 90 }),
      item({ id: 'b', start_time: '13:00:00' }),
    ])
    expect(warnings[0]?.kind).toBe('overlap')
  })

  it('treats an end before the start as crossing midnight', () => {
    // 23:00 → 01:00 is a two-hour night out, not a negative-length event.
    const warnings = dayWarnings([item({ id: 'club', start_time: '23:00:00', end_time: '01:00:00' })])
    expect(warnings).toEqual([])
  })

  it('flags a gap too short to cross the distance', () => {
    const warnings = dayWarnings([
      // Lisbon centre to Belém, ~6 km apart, with ten minutes between them.
      item({ id: 'a', start_time: '12:00:00', lat: 38.7223, lng: -9.1393 }),
      item({ id: 'b', start_time: '12:10:00', lat: 38.6979, lng: -9.2065 }),
    ])
    expect(warnings[0]).toMatchObject({ kind: 'tight', itemId: 'b' })
  })

  it('stays quiet when the gap is generous', () => {
    const warnings = dayWarnings([
      item({ id: 'a', start_time: '09:00:00', lat: 38.7223, lng: -9.1393 }),
      item({ id: 'b', start_time: '14:00:00', lat: 38.6979, lng: -9.2065 }),
    ])
    expect(warnings).toEqual([])
  })

  it('says nothing about items with no coordinates', () => {
    const warnings = dayWarnings([
      item({ id: 'a', start_time: '12:00:00' }),
      item({ id: 'b', start_time: '12:05:00' }),
    ])
    expect(warnings).toEqual([])
  })

  it('notes a busy day only on a long stay', () => {
    const five = Array.from({ length: 5 }, () => item({ scheduled_date: '2026-06-02' }))
    expect(dayWarnings(five, { isLongStay: true }).some((w) => w.kind === 'busy')).toBe(true)
    expect(dayWarnings(five, { isLongStay: false }).some((w) => w.kind === 'busy')).toBe(false)
  })
})

describe('pacing heuristics', () => {
  it('objects to three of the same category in a row', () => {
    const report = checkPacing([
      { category_id: 'food', duration_minutes: 60 },
      { category_id: 'food', duration_minutes: 60 },
      { category_id: 'food', duration_minutes: 60 },
    ])
    expect(report.ok).toBe(false)
    expect(report.problems).toContain('Three of the same kind in a row')
  })

  it('allows two in a row', () => {
    const report = checkPacing([
      { category_id: 'food', duration_minutes: 60 },
      { category_id: 'food', duration_minutes: 60 },
      { category_id: 'sight', duration_minutes: 60 },
    ])
    expect(report.ok).toBe(true)
  })

  it('does not treat two uncategorised items as a run', () => {
    const report = checkPacing([
      { category_id: null, duration_minutes: 30 },
      { category_id: null, duration_minutes: 30 },
      { category_id: null, duration_minutes: 30 },
    ])
    expect(report.ok).toBe(true)
  })

  it('objects to two long anchors in one day', () => {
    const report = checkPacing([
      { category_id: 'a', duration_minutes: 240 },
      { category_id: 'b', duration_minutes: 300 },
    ])
    expect(report.problems).toContain('More than one long anchor in a day')
  })
})

describe('display helpers', () => {
  it('formats an item time range', () => {
    expect(formatItemTime({ start_time: '14:00:00', end_time: '16:30:00' })).toBe('14:00 – 16:30')
    expect(formatItemTime({ start_time: '14:00:00', end_time: null })).toBe('14:00')
    expect(formatItemTime({ start_time: null, end_time: null })).toBe('')
  })

  it('converts a time to minutes past midnight', () => {
    expect(toMinutes('00:00')).toBe(0)
    expect(toMinutes('14:30:00')).toBe(870)
    expect(toMinutes(null)).toBeNull()
  })

  it('buckets a day by how full it is', () => {
    expect(dayDensity(0)).toBe('none')
    expect(dayDensity(2)).toBe('light')
    expect(dayDensity(4)).toBe('medium')
    expect(dayDensity(7)).toBe('full')
  })

  it('numbers days from the start of the trip', () => {
    expect(dayNumber('2026-06-01', '2026-06-01')).toBe(1)
    expect(dayNumber('2026-06-04', '2026-06-01')).toBe(4)
    expect(dayNumber('2026-05-30', '2026-06-01')).toBeNull()
    expect(dayNumber('2026-06-04', null)).toBeNull()
  })

  it('counts items per day, skipping the pool and deleted rows', () => {
    const counts = daysWithItems([
      item({ scheduled_date: '2026-06-02' }),
      item({ scheduled_date: '2026-06-02' }),
      item({ scheduled_date: '2026-06-03' }),
      item({ scheduled_date: null }),
      item({ scheduled_date: '2026-06-04', deleted_at: '2026-01-01T00:00:00Z' }),
    ])
    expect(counts.get('2026-06-02')).toBe(2)
    expect(counts.get('2026-06-03')).toBe(1)
    expect(counts.has('2026-06-04')).toBe(false)
  })
})

describe('the work-day overlay', () => {
  const toronto = {
    id: 'ada',
    timezone: 'America/Toronto',
    work_hours_start: '09:00',
    work_hours_end: '17:00',
  }

  it('moves a working day into the trip’s clock', () => {
    // The reason this is not a string comparison. Someone working 09:00–17:00
    // in Toronto is unavailable 14:00–22:00 on a Lisbon trip in June, and
    // drawing 09:00–17:00 would tell their partner the afternoon was free when
    // it is the one part that is not.
    const band = workBand(toronto, '2026-06-10', 'Europe/Lisbon')
    expect(band).toMatchObject({ personId: 'ada', from: '14:00', to: '22:00', clipped: false })
  })

  it('leaves a same-zone day exactly where it was entered', () => {
    expect(workBand(toronto, '2026-06-10', 'America/Toronto')).toMatchObject({
      from: '09:00',
      to: '17:00',
    })
  })

  it('clips rather than wraps when the day spills over midnight', () => {
    // A bar that restarts at the top of the same day reads as two shifts.
    const band = workBand(toronto, '2026-06-10', 'Asia/Tokyo')
    expect(band?.clipped).toBe(true)
    expect(band?.to).toBe('24:00')
  })

  it('draws nothing from a half-known working day', () => {
    expect(workBand({ ...toronto, work_hours_end: null }, '2026-06-10', 'UTC')).toBeNull()
    expect(workBand({ ...toronto, work_hours_start: null }, '2026-06-10', 'UTC')).toBeNull()
  })

  it('reads the offset for the date, so a DST change lands where it is', () => {
    // Toronto is UTC-5 in January and UTC-4 in June; Lisbon shifts too, but not
    // on the same days. Hard-coding one offset would be right for half the year.
    const winter = workBand(toronto, '2026-01-10', 'Europe/Lisbon')
    const summer = workBand(toronto, '2026-06-10', 'Europe/Lisbon')
    expect(winter?.from).toBe('14:00')
    expect(summer?.from).toBe('14:00')
  })

  it('knows whether a planned time lands in the middle of it', () => {
    const band = workBand(toronto, '2026-06-10', 'Europe/Lisbon')
    expect(clashesWithWork('15:30', band)).toBe(true)
    expect(clashesWithWork('22:00', band)).toBe(false)
    expect(clashesWithWork('13:59', band)).toBe(false)
    // An untimed item is not a clash — "sometime today" claims nothing.
    expect(clashesWithWork(null, band)).toBe(false)
  })
})
