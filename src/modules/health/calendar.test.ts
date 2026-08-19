import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PERIOD_DAYS,
  MAX_PROJECTED_CYCLES,
  averagePeriodDays,
  calendarMarks,
  describeProjectedCycle,
  monthGrid,
  monthOf,
  predictCycles,
  shiftMonth,
} from '@/modules/health/logic'
import type { CycleLog } from '@/modules/health/types'

/** Four regular 28-day cycles, each lasting five days. */
const regular = (): CycleLog[] =>
  ['2026-05-04', '2026-06-01', '2026-06-29', '2026-07-27'].map(
    (started, i) =>
      ({
        id: `c${i}`,
        owner_id: 'u1',
        started_on: started,
        ended_on: `${started.slice(0, 8)}${String(Number(started.slice(8)) + 4).padStart(2, '0')}`,
        flow: 'medium',
        ovulation_on: null,
        luteal_days: null,
        fertility_note: null,
        symptoms: null,
        notes: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      }) as CycleLog,
  )

describe('how long a period is taken to last', () => {
  it('averages the ones that have an end date', () => {
    expect(averagePeriodDays(regular())).toBe(5)
  })

  it('falls back when nothing has been finished', () => {
    // A period nobody finished recording is unknown, not one day long.
    const open = regular().map((l) => ({ ...l, ended_on: null }))
    expect(averagePeriodDays(open)).toBe(DEFAULT_PERIOD_DAYS)
    expect(averagePeriodDays([])).toBe(DEFAULT_PERIOD_DAYS)
  })
})

describe('projecting several cycles ahead', () => {
  it('spaces them by the average cycle length', () => {
    const cycles = predictCycles(regular(), 3)
    expect(cycles).toHaveLength(3)
    expect(cycles[0]!.start).toBe('2026-08-24')
    expect(cycles[1]!.start).toBe('2026-09-21')
    expect(cycles[2]!.start).toBe('2026-10-19')
  })

  it('widens the window the further out it goes', () => {
    // The point of the whole function. Cycle three's start is three cycle
    // lengths summed, so it carries three errors, not one. Drawing it as
    // confidently as cycle one would be a lie the calendar can easily avoid.
    const varied = regular().map((l, i) =>
      i === 2 ? { ...l, started_on: '2026-07-02' } : l,
    ) as CycleLog[]
    const cycles = predictCycles(varied, 4)
    const variances = cycles.map((c) => c.variance)
    expect(variances[0]).toBeLessThan(variances[3]!)
    for (let i = 1; i < variances.length; i++) {
      expect(variances[i]).toBeGreaterThanOrEqual(variances[i - 1]!)
    }
  })

  it('marks a fertile window and ovulation on every projected cycle', () => {
    for (const cycle of predictCycles(regular(), 3)) {
      expect(cycle.fertileFrom < cycle.ovulation).toBe(true)
      expect(cycle.fertileTo > cycle.ovulation).toBe(true)
      expect(cycle.ovulation < cycle.start).toBe(true)
      expect(cycle.isEstimate).toBe(true)
    }
  })

  it('uses a recorded ovulation to place the next one', () => {
    // Predicted, corrected, and the correction feeds forward.
    const logs = regular()
    const corrected = logs.map((l, i) =>
      i === logs.length - 1 ? { ...l, ovulation_on: '2026-08-08', luteal_days: 16 } : l,
    ) as CycleLog[]
    const [first] = predictCycles(corrected, 1)
    // 16 days before the projected start rather than the default 14.
    expect(first!.ovulation).toBe('2026-08-08')
  })

  it('refuses to project from too little', () => {
    expect(predictCycles(regular().slice(0, 2), 3)).toEqual([])
    expect(predictCycles([], 3)).toEqual([])
  })

  it('caps how far ahead it will go', () => {
    expect(predictCycles(regular(), 99)).toHaveLength(MAX_PROJECTED_CYCLES)
  })

  it('drops projections the calendar has already passed', () => {
    // Somebody who stopped logging for six months should not open the app to a
    // prediction for last spring.
    expect(predictCycles(regular(), 3, '2027-01-01')).toEqual([])
    expect(predictCycles(regular(), 3, '2026-08-01').length).toBeGreaterThan(0)
  })
})

describe('what each day on the calendar is', () => {
  const logs = regular()
  const cycles = predictCycles(logs, 3)

  it('marks logged period days, and the first one specially', () => {
    const marks = calendarMarks(logs, cycles, '2026-07-01', '2026-08-31')
    expect(marks.get('2026-07-27')?.period).toBe(true)
    expect(marks.get('2026-07-27')?.periodStart).toBe(true)
    expect(marks.get('2026-07-29')?.period).toBe(true)
    expect(marks.get('2026-07-29')?.periodStart).toBe(false)
  })

  it('marks projected period days differently from logged ones', () => {
    const marks = calendarMarks(logs, cycles, '2026-07-01', '2026-09-30')
    const projected = marks.get('2026-08-24')
    expect(projected?.predictedPeriod).toBe(true)
    expect(projected?.period).toBe(false)
  })

  it('lets a fact overwrite a guess on the same square', () => {
    // The reason this is one function rather than four lists in the component.
    // Logging a period where one was predicted must read as logged, or the
    // calendar shows a prediction for something that already happened.
    const withActual = [
      ...logs,
      { ...logs[0]!, id: 'actual', started_on: '2026-08-24', ended_on: '2026-08-28' },
    ]
    const marks = calendarMarks(withActual, cycles, '2026-08-01', '2026-08-31')
    expect(marks.get('2026-08-24')?.period).toBe(true)
    expect(marks.get('2026-08-24')?.predictedPeriod).toBe(false)
  })

  it('lets a recorded ovulation outrank a projected one', () => {
    const observed = predictCycles(logs, 1)
    const day = observed[0]!.ovulation
    const withObservation = [...logs, { ...logs[0]!, id: 'obs', ovulation_on: day }]
    const marks = calendarMarks(withObservation, observed, '2026-07-01', '2026-09-30')
    expect(marks.get(day)?.ovulationObserved).toBe(true)
    expect(marks.get(day)?.ovulation).toBe(false)
  })

  it('marks the fertile window', () => {
    const marks = calendarMarks(logs, cycles, '2026-08-01', '2026-08-31')
    const cycle = cycles[0]!
    expect(marks.get(cycle.fertileFrom)?.fertile).toBe(true)
    expect(marks.get(cycle.ovulation)?.fertile).toBe(true)
  })

  it('returns nothing outside the range it was asked about', () => {
    const marks = calendarMarks(logs, cycles, '2026-08-01', '2026-08-31')
    expect(marks.get('2026-07-27')).toBeUndefined()
    expect(marks.get('2026-12-01')).toBeUndefined()
  })

  it('says which projected cycle a day belongs to', () => {
    const marks = calendarMarks(logs, cycles, '2026-08-01', '2026-10-31')
    expect(marks.get(cycles[0]!.start)?.cycleIndex).toBe(1)
    expect(marks.get(cycles[1]!.start)?.cycleIndex).toBe(2)
  })
})

describe('the month grid', () => {
  it('is always whole weeks', () => {
    for (const month of ['2026-01-01', '2026-02-01', '2026-08-01', '2027-02-01']) {
      expect(monthGrid(month).length % 7).toBe(0)
    }
  })

  it('starts on the configured weekday', () => {
    // Monday-first by default, which is what the couple settings default to.
    const grid = monthGrid('2026-08-01')
    expect(new Date(`${grid[0]!}T00:00:00Z`).getUTCDay()).toBe(1)
    const sundayFirst = monthGrid('2026-08-01', 0)
    expect(new Date(`${sundayFirst[0]!}T00:00:00Z`).getUTCDay()).toBe(0)
  })

  it('includes the neighbouring days that fill the first and last weeks', () => {
    // A period straddling a month boundary should be visible on both months,
    // and a grid with holes reads as missing data.
    const grid = monthGrid('2026-08-01')
    expect(grid).toContain('2026-07-27')
    expect(grid).toContain('2026-08-31')
  })

  it('covers every day of the month itself', () => {
    const grid = monthGrid('2026-02-01')
    for (let d = 1; d <= 28; d++) {
      expect(grid).toContain(`2026-02-${String(d).padStart(2, '0')}`)
    }
  })
})

describe('moving between months', () => {
  it('steps forward and back', () => {
    expect(shiftMonth('2026-08-01', 1)).toBe('2026-09-01')
    expect(shiftMonth('2026-08-01', -1)).toBe('2026-07-01')
  })

  it('crosses a year boundary', () => {
    expect(shiftMonth('2026-12-01', 1)).toBe('2027-01-01')
    expect(shiftMonth('2026-01-01', -1)).toBe('2025-12-01')
  })

  it('finds the first of the month a date is in', () => {
    expect(monthOf('2026-08-24')).toBe('2026-08-01')
    expect(monthOf('2026-08-01')).toBe('2026-08-01')
  })
})

describe('describing a projected cycle', () => {
  it('gives a day when it is confident and a range when it is not', () => {
    const tight = { ...predictCycles(regular(), 1)[0]!, variance: 1 }
    expect(describeProjectedCycle(tight)).toContain('give or take 1 day')

    const wide = { ...tight, variance: 9 }
    expect(describeProjectedCycle(wide)).toContain(wide.earliest)
    expect(describeProjectedCycle(wide)).toContain(wide.latest)
  })

  it('names which cycle it is talking about', () => {
    const [first, second] = predictCycles(regular(), 2)
    expect(describeProjectedCycle(first!)).toMatch(/^Next:/)
    expect(describeProjectedCycle(second!)).toMatch(/^2 cycles ahead:/)
  })

  it('always mentions the fertile window and ovulation', () => {
    const cycle = predictCycles(regular(), 1)[0]!
    const text = describeProjectedCycle(cycle)
    expect(text).toContain('Fertile window')
    expect(text).toContain('ovulation near')
  })
})

describe('perfectly regular cycles', () => {
  it('does not promise a day it cannot promise', () => {
    // Four identical 28-day gaps give a variance of zero. Saying "give or take
    // 0 days" would read as a guarantee, which no estimate from six data
    // points is — so the phrase is dropped rather than printed with a zero.
    const cycle = predictCycles(regular(), 1)[0]!
    expect(cycle.variance).toBe(0)
    const text = describeProjectedCycle(cycle)
    expect(text).toContain(`around ${cycle.start}`)
    expect(text).not.toContain('give or take')
  })
})
