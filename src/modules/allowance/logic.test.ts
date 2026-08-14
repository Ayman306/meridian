import { describe, expect, it } from 'vitest'
import {
  checkPlannedStay,
  daysUsedOn,
  describeRule,
  findOverlaps,
  mergeStays,
  mustLeaveBy,
  ruleFor,
  staysForRule,
  statusFor,
  suggestFromTrip,
  usedOnFor,
} from '@/modules/allowance/logic'
import type { AllowanceRule, EntryExitLog, Stay } from '@/modules/allowance/types'

const SCHENGEN = [
  'AT', 'BE', 'BG', 'HR', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE',
  'GR', 'HU', 'IS', 'IT', 'LV', 'LI', 'LT', 'LU', 'MT', 'NL',
  'NO', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'CH',
]

const rule = (over: Partial<AllowanceRule> = {}): AllowanceRule => ({
  id: 'r1',
  couple_id: null,
  user_id: null,
  passport_country: 'US',
  destination_country: 'SCHENGEN',
  rule_type: 'rolling',
  max_days: 90,
  window_days: 180,
  region_members: SCHENGEN,
  label: null,
  notes: null,
  source_url: 'https://example.test/rule',
  verified_on: '2026-01-01',
  window_start: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...over,
})

let seq = 0
const entry = (over: Partial<EntryExitLog> = {}): EntryExitLog => ({
  id: `e${++seq}`,
  couple_id: 'c1',
  user_id: 'me',
  country_code: 'PT',
  entered_on: '2026-01-01',
  exited_on: '2026-01-10',
  trip_id: null,
  is_estimated: false,
  notes: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...over,
})

const stay = (entered_on: string, exited_on: string | null = null): Stay => ({
  entered_on,
  exited_on,
})

describe('daysUsedOn', () => {
  it('counts both the entry day and the exit day', () => {
    // 1st to 3rd inclusive is three days, not two.
    expect(daysUsedOn([stay('2026-03-01', '2026-03-03')], '2026-03-10', 180)).toBe(3)
  })

  it('counts a same-day in-and-out as one day', () => {
    expect(daysUsedOn([stay('2026-03-01', '2026-03-01')], '2026-03-01', 180)).toBe(1)
  })

  it('includes the evaluation date in the window', () => {
    // A 1-day window on the day itself sees only that day.
    expect(daysUsedOn([stay('2026-03-01', '2026-03-05')], '2026-03-03', 1)).toBe(1)
  })

  it('clips a stay that starts before the window opens', () => {
    // Window is 2026-03-04..2026-03-10; the stay covers the 1st to the 6th.
    expect(daysUsedOn([stay('2026-03-01', '2026-03-06')], '2026-03-10', 7)).toBe(3)
  })

  it('counts an open-ended stay through the evaluation date and no further', () => {
    expect(daysUsedOn([stay('2026-03-01', null)], '2026-03-05', 180)).toBe(5)
  })

  it('ignores a stay entirely outside the window', () => {
    expect(daysUsedOn([stay('2025-01-01', '2025-01-10')], '2026-03-10', 180)).toBe(0)
  })
})

describe('checkPlannedStay — the Schengen case from the spec', () => {
  it('flags a breach when 89 days are used and a 5-day trip is planned', () => {
    // Spec 10.7's acceptance test. 89 consecutive days ending the day before
    // the planned arrival, so nothing has fallen out of the window yet.
    const used = [stay('2026-01-01', '2026-03-30')] // 89 days
    expect(daysUsedOn(used, '2026-03-30', 180)).toBe(89)

    const result = checkPlannedStay(used, '2026-03-31', '2026-04-04', rule(), '2026-03-30')
    expect(result.verdict).toBe('breach')
    // Day 90 is fine; the 91st day is the breach — the second day of the trip.
    expect(result.breachDate).toBe('2026-04-01')
  })

  it('detects a breach on a mid-stay day, not just on arrival', () => {
    // 85 days used, then a 10-day trip. Arrival is day 86 — legal. The breach
    // arrives five days in, which an arrival-only check would never see.
    const used = [stay('2026-01-01', '2026-03-26')] // 85 days
    const result = checkPlannedStay(used, '2026-04-01', '2026-04-10', rule(), '2026-03-30')

    expect(result.verdict).toBe('breach')
    expect(result.breachDate).not.toBe('2026-04-01')
    expect(result.breachDate! > '2026-04-01').toBe(true)
  })

  it('passes a stay that fits, and reports the headroom at the peak', () => {
    const used = [stay('2026-01-01', '2026-01-20')] // 20 days
    const result = checkPlannedStay(used, '2026-04-01', '2026-04-10', rule(), '2026-03-30')

    expect(result.verdict).toBe('ok')
    expect(result.breachDate).toBeNull()
    expect(result.peak).toBe(30)
    expect(result.headroom).toBe(60)
  })

  it('warns when a stay is legal but tight', () => {
    const used = [stay('2026-01-01', '2026-03-25')] // 84 days
    const result = checkPlannedStay(used, '2026-03-26', '2026-03-30', rule(), '2026-03-25')
    expect(result.verdict).toBe('tight')
    expect(result.breachDate).toBeNull()
  })

  it('handles a trip spanning two windows', () => {
    // Spec 10.6 asks for this case explicitly. A 90-day stay ending 29 Dec,
    // then 20 days in June. Most of the old stay has aged out of the 180-day
    // window by then, but not all of it: on 1 June the window reaches back to
    // 4 December, so 26 of those days still count, plus the day itself.
    // A naive "90 + 20" would flag a breach that never happens.
    const used = [stay('2025-10-01', '2025-12-29')] // 90 days
    const result = checkPlannedStay(used, '2026-06-01', '2026-06-20', rule(), '2026-05-01')

    expect(result.verdict).toBe('ok')
    expect(result.peak).toBe(27)
    expect(result.peakDate).toBe('2026-06-01')
  })

  it('reports "untracked" rather than "fine" when there is no rule', () => {
    const result = checkPlannedStay([], '2026-04-01', '2026-04-10', null, '2026-03-01')
    expect(result.verdict).toBe('untracked')
  })

  it('passes anything under a no-limit rule', () => {
    const result = checkPlannedStay(
      [stay('2026-01-01', '2026-12-31')],
      '2026-04-01',
      '2026-04-10',
      rule({ rule_type: 'none', max_days: 0, window_days: null }),
      '2026-03-01',
    )
    expect(result.verdict).toBe('ok')
  })
})

describe('zone counting', () => {
  it('counts days in any Schengen member against the same total', () => {
    const log = [
      entry({ country_code: 'PT', entered_on: '2026-01-01', exited_on: '2026-01-10' }),
      entry({ country_code: 'ES', entered_on: '2026-02-01', exited_on: '2026-02-10' }),
      entry({ country_code: 'IT', entered_on: '2026-03-01', exited_on: '2026-03-10' }),
    ]
    const stays = staysForRule(log, rule())
    expect(stays).toHaveLength(3)
    expect(daysUsedOn(stays, '2026-03-10', 180)).toBe(30)
  })

  it('leaves a non-member country out of the zone total', () => {
    const log = [
      entry({ country_code: 'PT', entered_on: '2026-01-01', exited_on: '2026-01-10' }),
      entry({ country_code: 'GB', entered_on: '2026-02-01', exited_on: '2026-02-28' }),
    ]
    expect(daysUsedOn(staysForRule(log, rule()), '2026-03-01', 180)).toBe(10)
  })
})

describe('other rule types', () => {
  it('per_entry counts only the current visit', () => {
    const perEntry = rule({ rule_type: 'per_entry', max_days: 90, window_days: null, region_members: null, destination_country: 'GB' })
    const stays = [stay('2026-01-01', '2026-02-01'), stay('2026-05-01', '2026-05-10')]
    expect(usedOnFor(stays, '2026-05-10', perEntry, '2026-05-10')).toBe(10)
  })

  it('per_year counts everything inside the calendar year', () => {
    const perYear = rule({ rule_type: 'per_year', max_days: 180, window_days: null })
    const stays = [stay('2025-12-20', '2026-01-05'), stay('2026-06-01', '2026-06-10')]
    // 5 days spill into 2026, plus 10 in June.
    expect(usedOnFor(stays, '2026-12-31', perYear, '2026-12-31')).toBe(15)
  })

  it('per_visa counts from the issue date, and reports nothing without one', () => {
    const withStart = rule({
      rule_type: 'per_visa',
      max_days: 180,
      window_days: null,
      window_start: '2026-03-01',
    })
    const stays = [stay('2026-01-01', '2026-01-31'), stay('2026-03-05', '2026-03-14')]
    expect(usedOnFor(stays, '2026-04-01', withStart, '2026-04-01')).toBe(10)

    const noStart = rule({ ...withStart, window_start: null })
    expect(usedOnFor(stays, '2026-04-01', noStart, '2026-04-01')).toBe(0)
  })
})

describe('mergeStays', () => {
  it('merges overlapping rows so a day is never counted twice', () => {
    const merged = mergeStays(
      [stay('2026-01-01', '2026-01-10'), stay('2026-01-05', '2026-01-15')],
      '2026-02-01',
    )
    expect(merged).toEqual([{ entered_on: '2026-01-01', exited_on: '2026-01-15' }])
  })

  it('treats back-to-back stays as continuous', () => {
    const merged = mergeStays(
      [stay('2026-01-01', '2026-01-10'), stay('2026-01-11', '2026-01-20')],
      '2026-02-01',
    )
    expect(merged).toHaveLength(1)
  })

  it('keeps a genuine gap as two stays', () => {
    const merged = mergeStays(
      [stay('2026-01-01', '2026-01-10'), stay('2026-01-20', '2026-01-25')],
      '2026-02-01',
    )
    expect(merged).toHaveLength(2)
  })

  it('keeps an open stay open when it swallows a closed one', () => {
    const merged = mergeStays([stay('2026-01-01', null), stay('2026-01-05', '2026-01-09')], '2026-02-01')
    expect(merged).toEqual([{ entered_on: '2026-01-01', exited_on: null }])
  })

  it('stops a duplicated row from double-counting the same days', () => {
    const duplicated = [stay('2026-01-01', '2026-01-10'), stay('2026-01-01', '2026-01-10')]
    expect(daysUsedOn(mergeStays(duplicated, '2026-02-01'), '2026-02-01', 180)).toBe(10)
  })
})

describe('mustLeaveBy', () => {
  it('is the last day before the limit would be exceeded', () => {
    // Arrived 10 days ago and still there: 80 days remain of 90.
    const stays = [stay('2026-03-01', null)]
    const leaveBy = mustLeaveBy(stays, rule(), '2026-03-10')
    // Day 1 is 1 March, so day 90 is 29 May.
    expect(leaveBy).toBe('2026-05-29')
  })

  it('gives no date under a no-limit rule', () => {
    const noLimit = rule({ rule_type: 'none', max_days: 0, window_days: null })
    expect(mustLeaveBy([stay('2026-01-01', null)], noLimit, '2026-06-01')).toBeNull()
  })
})

describe('statusFor', () => {
  it('reports used, remaining and presence', () => {
    const log = [entry({ country_code: 'PT', entered_on: '2026-03-01', exited_on: null })]
    const status = statusFor(log, rule(), '2026-03-10')

    expect(status.used).toBe(10)
    expect(status.remaining).toBe(80)
    expect(status.isPresent).toBe(true)
    expect(status.windowStart).toBe('2025-09-12')
  })

  it('has no must-leave-by date when they are not there', () => {
    const log = [entry({ country_code: 'PT', entered_on: '2026-01-01', exited_on: '2026-01-10' })]
    expect(statusFor(log, rule(), '2026-03-10').mustLeaveBy).toBeNull()
  })
})

describe('ruleFor', () => {
  const defaultRule = rule({ id: 'default', passport_country: 'US' })
  const override = rule({
    id: 'override',
    couple_id: 'c1',
    user_id: 'me',
    max_days: 365,
    rule_type: 'none',
    destination_country: 'PT',
    region_members: null,
  })

  it('finds the default for a matching passport', () => {
    expect(ruleFor([defaultRule], 'me', 'PT', ['US'])?.id).toBe('default')
  })

  it('returns null for a passport with no rule — never a permissive default', () => {
    expect(ruleFor([defaultRule], 'me', 'PT', ['NZ'])).toBeNull()
  })

  it('returns null for an untracked country', () => {
    expect(ruleFor([defaultRule], 'me', 'BR', ['US'])).toBeNull()
  })

  it('prefers the person’s own override', () => {
    expect(ruleFor([defaultRule, override], 'me', 'PT', ['US'])?.id).toBe('override')
  })

  it('does not apply one person’s override to the other', () => {
    expect(ruleFor([defaultRule, override], 'them', 'PT', ['US'])?.id).toBe('default')
  })

  it('checks the second passport too', () => {
    expect(ruleFor([defaultRule], 'me', 'PT', ['IN', 'US'])?.id).toBe('default')
  })
})

describe('findOverlaps', () => {
  it('spots two rows covering the same days for one person', () => {
    const a = entry({ entered_on: '2026-01-01', exited_on: '2026-01-10' })
    const b = entry({ entered_on: '2026-01-05', exited_on: '2026-01-15' })
    expect(findOverlaps([a, b], '2026-02-01')).toHaveLength(1)
  })

  it('does not compare one person against the other', () => {
    const mine = entry({ user_id: 'me', entered_on: '2026-01-01', exited_on: '2026-01-10' })
    const theirs = entry({ user_id: 'them', entered_on: '2026-01-05', exited_on: '2026-01-15' })
    expect(findOverlaps([mine, theirs], '2026-02-01')).toHaveLength(0)
  })
})

describe('suggestFromTrip', () => {
  const trip = {
    id: 't1',
    title: 'Lisbon',
    start_date: '2026-06-01',
    end_date: '2026-06-10',
    date_precision: 'exact',
  }
  const travellers = [{ user_id: 'me', arrival_date: null, departure_date: null }]

  it('suggests the trip window when nothing is logged', () => {
    const [suggestion] = suggestFromTrip(trip, 'PT', travellers, [])
    expect(suggestion).toMatchObject({
      userId: 'me',
      countryCode: 'PT',
      enteredOn: '2026-06-01',
      exitedOn: '2026-06-10',
    })
  })

  it('uses each traveller’s own dates when they differ from the trip', () => {
    const [suggestion] = suggestFromTrip(
      trip,
      'PT',
      [{ user_id: 'me', arrival_date: '2026-06-03', departure_date: '2026-06-08' }],
      [],
    )
    expect(suggestion).toMatchObject({ enteredOn: '2026-06-03', exitedOn: '2026-06-08' })
  })

  it('says nothing when the stay is already logged', () => {
    const logged = [
      entry({ user_id: 'me', country_code: 'PT', entered_on: '2026-06-01', exited_on: '2026-06-10' }),
    ]
    expect(suggestFromTrip(trip, 'PT', travellers, logged)).toHaveLength(0)
  })

  it('refuses to invent dates from a vague trip', () => {
    // "June 2026" is stored as the 1st. Logging that as a border crossing
    // would be a date the app made up.
    expect(suggestFromTrip({ ...trip, date_precision: 'month' }, 'PT', travellers, [])).toHaveLength(0)
  })

  it('says nothing without a destination', () => {
    expect(suggestFromTrip(trip, null, travellers, [])).toHaveLength(0)
  })
})

describe('describeRule', () => {
  it('says what each rule type means in words', () => {
    expect(describeRule(rule())).toBe('90 days in any 180')
    expect(describeRule(rule({ rule_type: 'per_entry' }))).toBe('90 days per entry')
    expect(describeRule(rule({ rule_type: 'per_year' }))).toBe('90 days per calendar year')
    expect(describeRule(rule({ rule_type: 'none' }))).toBe('No limit')
  })
})
