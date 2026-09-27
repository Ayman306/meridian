import { describe, expect, it } from 'vitest'
import {
  FERTILITY_DISCLAIMER,
  describeFertility,
  predictFertility,
  showsCycle,
  NOT_CHECKED,
  SCOPES,
  checkSupply,
  cycleDays,
  cycleLengths,
  describePrediction,
  describeSharing,
  describeSupply,
  grantedScopes,
  groupTips,
  hasConsent,
  isEmptyLog,
  summariseIntimacy,
  visibleTips,
  matchRestrictions,
  periodLength,
  predict,
  restrictionNotice,
} from '@/modules/health/logic'
import type {
  CycleLog,
  HealthConsent,
  HealthRecord,
  IntimacyLog,
  WellnessTip,
  MedicationRestriction,
} from '@/modules/health/types'

const OWNER = 'user-ada'
const VIEWER = 'user-bo'

const cycle = (startedOn: string, over: Partial<CycleLog> = {}): CycleLog =>
  ({
    id: `c-${startedOn}`,
    owner_id: OWNER,
    started_on: startedOn,
    ended_on: null,
    flow: null,
    symptoms: null,
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  }) as CycleLog

const record = (over: Partial<HealthRecord> = {}): HealthRecord =>
  ({
    id: 'r1',
    owner_id: OWNER,
    kind: 'medication',
    label: 'Sudafed',
    detail: {},
    dosage: '60mg',
    frequency: 'twice a day',
    doses_per_day: 2,
    quantity_remaining: 40,
    started_on: null,
    valid_until: null,
    document_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  }) as HealthRecord

const restriction = (over: Partial<MedicationRestriction> = {}): MedicationRestriction =>
  ({
    id: 'x1',
    country_code: 'JP',
    substance: 'pseudoephedrine',
    restriction: 'Prohibited',
    source_url: 'https://example.gov',
    verified_on: '2026-08-14',
    created_at: '2026-01-01T00:00:00Z',
    ...over,
  }) as MedicationRestriction

const consent = (over: Partial<HealthConsent> = {}): HealthConsent =>
  ({
    id: 'k1',
    owner_id: OWNER,
    viewer_id: VIEWER,
    scope: 'cycle',
    granted_at: '2026-01-01T00:00:00Z',
    revoked_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  }) as HealthConsent

describe('prediction', () => {
  it('refuses below three cycles, and says why', () => {
    // Spec 12.7. An empty card would look like a bug; a guess would be worse.
    const none = predict([])
    expect(none.available).toBe(false)
    if (!none.available) expect(none.reason).toContain('Nothing logged')

    const two = predict([cycle('2026-01-01'), cycle('2026-01-29')])
    expect(two.available).toBe(false)
    if (!two.available) expect(two.basedOn).toBe(2)
  })

  it('predicts from the average gap once there are three', () => {
    const result = predict([cycle('2026-01-01'), cycle('2026-01-29'), cycle('2026-02-26')])
    expect(result.available).toBe(true)
    if (!result.available) return
    expect(result.averageLength).toBe(28)
    expect(result.nextStart).toBe('2026-03-26')
    expect(result.basedOn).toBe(3)
  })

  it('is always an estimate, with no branch that says otherwise', () => {
    const result = predict([cycle('2026-01-01'), cycle('2026-01-29'), cycle('2026-02-26')])
    if (!result.available) throw new Error('expected a prediction')
    expect(result.isEstimate).toBe(true)
    expect(result.variance).toBeGreaterThanOrEqual(0)
  })

  it('calls a steady cycle regular', () => {
    const result = predict([
      cycle('2026-01-01'),
      cycle('2026-01-29'),
      cycle('2026-02-26'),
      cycle('2026-03-26'),
    ])
    if (!result.available) throw new Error('expected a prediction')
    expect(result.confidence).toBe('regular')
    expect(result.variance).toBe(0)
  })

  it('calls a wildly varying one irregular and shows a range', () => {
    // Spec 12.7: irregular cycles must not be shown as a confident date.
    const result = predict([
      cycle('2026-01-01'),
      cycle('2026-01-21'), // 20
      cycle('2026-03-05'), // 43
      cycle('2026-03-27'), // 22
    ])
    if (!result.available) throw new Error('expected a prediction')
    expect(result.confidence).toBe('irregular')
    expect(describePrediction(result)).toContain('Somewhere between')
    expect(describePrediction(result)).not.toMatch(/^Around/)
  })

  it('uses at most the last six cycles', () => {
    const many = Array.from({ length: 10 }, (_, i) => cycle(`2026-01-${String(i * 3 + 1).padStart(2, '0')}`))
    const result = predict(many)
    if (!result.available) throw new Error('expected a prediction')
    expect(result.basedOn).toBe(6)
  })

  it('does not care what order the logs arrive in', () => {
    const forwards = predict([cycle('2026-01-01'), cycle('2026-01-29'), cycle('2026-02-26')])
    const backwards = predict([cycle('2026-02-26'), cycle('2026-01-01'), cycle('2026-01-29')])
    expect(backwards).toEqual(forwards)
  })

  it('never renders a date without the variance beside it', () => {
    const result = predict([cycle('2026-01-01'), cycle('2026-01-30'), cycle('2026-02-26')])
    if (!result.available) throw new Error('expected a prediction')
    const sentence = describePrediction(result)
    expect(sentence).toMatch(/estimate|Somewhere between/)
  })
})

describe('cycle arithmetic', () => {
  it('measures a period inclusively', () => {
    expect(periodLength(cycle('2026-05-01', { ended_on: '2026-05-05' }))).toBe(5)
  })

  it('has no length for one still going', () => {
    expect(periodLength(cycle('2026-05-01'))).toBeNull()
  })

  it('measures cycle lengths start to start', () => {
    expect(cycleLengths([cycle('2026-01-01'), cycle('2026-01-29')])).toEqual([28])
  })

  it('lists the days a log covers', () => {
    expect(cycleDays(cycle('2026-05-01', { ended_on: '2026-05-03' }))).toEqual([
      '2026-05-01',
      '2026-05-02',
      '2026-05-03',
    ])
  })

  it('treats a log with no end as one day', () => {
    expect(cycleDays(cycle('2026-05-01'))).toEqual(['2026-05-01'])
  })
})

describe('medication supply', () => {
  it('works out how long it lasts', () => {
    // 40 left at 2 a day is 20 days, against 14 nights.
    const check = checkSupply(record(), 14)
    expect(check.daysOfSupply).toBe(20)
    expect(check.shortfall).toBe(0)
  })

  it('says by how much it falls short', () => {
    const check = checkSupply(record(), 30)
    expect(check.shortfall).toBe(10)
    expect(describeSupply(check, 'Sudafed')).toContain('short by 10 days')
  })

  it('refuses to guess when the numbers are missing', () => {
    // A person may write "one in the morning" and never fill in the count.
    const check = checkSupply(record({ doses_per_day: null, quantity_remaining: null }), 14)
    expect(check.computable).toBe(false)
    expect(describeSupply(check, 'Sudafed')).toBeNull()
  })

  it('does not divide by zero', () => {
    expect(checkSupply(record({ doses_per_day: 0 }), 14).computable).toBe(false)
  })
})

describe('border restrictions', () => {
  it('matches a brand name against a substance', () => {
    const matches = matchRestrictions([record({ label: 'Sudafed', dosage: 'pseudoephedrine 60mg' })], [restriction()])
    expect(matches).toHaveLength(1)
    expect(matches[0]!.restriction.substance).toBe('pseudoephedrine')
  })

  it('matches a substance named directly', () => {
    const matches = matchRestrictions(
      [record({ label: 'Codeine', dosage: '30mg' })],
      [restriction({ substance: 'codeine' })],
    )
    expect(matches).toHaveLength(1)
  })

  it('ignores anything that is not a medication', () => {
    const matches = matchRestrictions(
      [record({ kind: 'vaccination', label: 'pseudoephedrine' })],
      [restriction()],
    )
    expect(matches).toHaveLength(0)
  })

  it('never asserts a rule — it points at the source', () => {
    // Spec 12.2. The copy is checked because it is the copy that matters.
    const notice = restrictionNotice('Japan')
    expect(notice).toContain('Check the official guidance')
    expect(notice).not.toMatch(/\b(safe|allowed|permitted|illegal|banned)\b/i)
  })

  it('says "not checked" rather than "safe" when there is no data', () => {
    expect(matchRestrictions([record()], [])).toHaveLength(0)
    expect(NOT_CHECKED).toContain('not been checked')
    expect(NOT_CHECKED).not.toMatch(/\bsafe\b/i)
  })
})

describe('consent', () => {
  it('reads a live grant', () => {
    expect(hasConsent([consent()], OWNER, VIEWER, 'cycle')).toBe(true)
  })

  it('does not read a revoked one', () => {
    expect(
      hasConsent([consent({ revoked_at: '2026-02-01T00:00:00Z' })], OWNER, VIEWER, 'cycle'),
    ).toBe(false)
  })

  it('keeps the scopes separate', () => {
    expect(hasConsent([consent()], OWNER, VIEWER, 'medications')).toBe(false)
  })

  it('does not confuse one viewer for another', () => {
    expect(hasConsent([consent()], OWNER, 'somebody-else', 'cycle')).toBe(false)
  })

  it('lists exactly what is shared', () => {
    const consents = [consent(), consent({ id: 'k2', scope: 'medications' })]
    expect(grantedScopes(consents, VIEWER)).toEqual(['cycle', 'medications'])
    expect(describeSharing(grantedScopes(consents, VIEWER))).toBe(
      'Shared: Cycle dates, Medications.',
    )
  })

  it('says plainly when nothing is shared', () => {
    expect(describeSharing([])).toBe('Nothing is shared.')
    expect(describeSharing(SCOPES)).toBe('Everything is shared.')
  })

  it('defaults to nothing', () => {
    // Spec 12.2: "Default: everything off."
    expect(grantedScopes([], VIEWER)).toEqual([])
  })
})

describe('who sees the cycle section', () => {
  it('shows it by default to someone who said female', () => {
    expect(showsCycle({ gender: 'female', tracks_cycle: null })).toBe(true)
  })

  it('hides it by default from everyone else', () => {
    expect(showsCycle({ gender: 'male', tracks_cycle: null })).toBe(false)
    expect(showsCycle({ gender: 'other', tracks_cycle: null })).toBe(false)
    expect(showsCycle({ gender: 'prefer_not_to_say', tracks_cycle: null })).toBe(false)
    expect(showsCycle({ gender: null, tracks_cycle: null })).toBe(false)
  })

  it('lets an explicit choice beat the default, both ways', () => {
    // A woman past menopause turning it off, and somebody the default would
    // have hidden it from turning it on. Neither is an edge case.
    expect(showsCycle({ gender: 'female', tracks_cycle: false })).toBe(false)
    expect(showsCycle({ gender: 'male', tracks_cycle: true })).toBe(true)
    expect(showsCycle({ gender: null, tracks_cycle: true })).toBe(true)
  })

  it('shows nothing for a missing profile', () => {
    expect(showsCycle(null)).toBe(false)
  })
})

describe('fertile window', () => {
  const threeCycles = [cycle('2026-01-01'), cycle('2026-01-29'), cycle('2026-02-26')]

  it('says nothing without a period prediction to anchor to', () => {
    // An ovulation date derived from nothing is worse than no date.
    expect(predictFertility(predict([]), [])).toBeNull()
    expect(predictFertility(predict([cycle('2026-01-01')]), [])).toBeNull()
  })

  it('places ovulation a luteal phase before the next period', () => {
    const prediction = predict(threeCycles)
    const window = predictFertility(prediction, threeCycles)
    if (!prediction.available) throw new Error('expected a prediction')
    // Next start 2026-03-26, minus the default 14 days.
    expect(window?.ovulation).toBe('2026-03-12')
    expect(window?.lutealDays).toBe(14)
    expect(window?.basedOn).toBe('estimated')
  })

  it('spans five days before ovulation to one day after', () => {
    const window = predictFertility(predict(threeCycles), threeCycles)
    expect(window?.fertileFrom).toBe('2026-03-07')
    expect(window?.fertileTo).toBe('2026-03-13')
  })

  it('is always an estimate, and inherits the cycle variance', () => {
    const prediction = predict(threeCycles)
    const window = predictFertility(prediction, threeCycles)
    if (!prediction.available) throw new Error('expected a prediction')
    expect(window?.isEstimate).toBe(true)
    expect(window?.variance).toBe(prediction.variance)
  })

  it('prefers a recorded ovulation over the default', () => {
    // She measured it. What she measured beats what we would have guessed.
    const logs = [
      cycle('2026-01-01'),
      cycle('2026-01-29', { ovulation_on: '2026-02-10' }), // 16 days before 26 Feb
      cycle('2026-02-26'),
    ]
    const window = predictFertility(predict(logs), logs)
    expect(window?.basedOn).toBe('observed')
    expect(window?.lutealDays).toBe(16)
    expect(window?.ovulation).toBe('2026-03-10')
  })

  it('honours a luteal length she entered directly', () => {
    const logs = [
      cycle('2026-01-01'),
      cycle('2026-01-29', { ovulation_on: '2026-02-12', luteal_days: 12 }),
      cycle('2026-02-26'),
    ]
    expect(predictFertility(predict(logs), logs)?.lutealDays).toBe(12)
  })

  it('ignores an implausible derived luteal length', () => {
    // 40 days is not a luteal phase; fall back rather than propagate nonsense.
    const logs = [
      cycle('2026-01-01'),
      cycle('2026-01-29', { ovulation_on: '2026-01-29' }),
      cycle('2026-03-20'),
    ]
    expect(predictFertility(predict(logs), logs)?.lutealDays).toBe(14)
  })

  it('never states a date without saying it is an estimate', () => {
    const window = predictFertility(predict(threeCycles), threeCycles)
    const sentence = describeFertility(window)!
    expect(sentence).toMatch(/estimate|give or take/)
  })

  it('widens the language when the cycle is irregular', () => {
    const irregular = [
      cycle('2026-01-01'),
      cycle('2026-01-21'),
      cycle('2026-03-05'),
      cycle('2026-03-27'),
    ]
    const sentence = describeFertility(predictFertility(predict(irregular), irregular))!
    expect(sentence).toContain('Roughly')
    expect(sentence).toContain('wide estimate')
  })

  it('never mentions contraception or safety', () => {
    // The line this module does not cross, asserted rather than trusted.
    const sentence = describeFertility(predictFertility(predict(threeCycles), threeCycles))!
    for (const text of [sentence, FERTILITY_DISCLAIMER]) {
      expect(text).not.toMatch(/\bsafe\b|\bprotect/i)
    }
    expect(FERTILITY_DISCLAIMER).toMatch(/not a method of contraception/i)
  })

  it('has nothing to describe when there is no window', () => {
    expect(describeFertility(null)).toBeNull()
  })
})

describe('the intimacy log', () => {
  const log = (over: Partial<IntimacyLog> & { logged_on: string }): IntimacyLog =>
    ({
      id: over.logged_on,
      owner_id: 'me',
      desire: null,
      solo: false,
      partnered: false,
      orgasms: 0,
      notes: null,
      created_at: '',
      updated_at: '',
      ...over,
    }) as IntimacyLog

  describe('summariseIntimacy', () => {
    const logs = [
      log({ logged_on: '2026-09-01', desire: 4, solo: true, orgasms: 1 }),
      log({ logged_on: '2026-09-02', desire: 2 }),
      log({ logged_on: '2026-09-03', desire: 5, partnered: true, orgasms: 2 }),
      log({ logged_on: '2026-08-20', desire: 1, solo: true, orgasms: 9 }),
    ]

    it('counts only what falls inside the window', () => {
      const s = summariseIntimacy(logs, '2026-09-01', '2026-09-30')
      expect(s.daysLogged).toBe(3)
      expect(s.solo).toBe(1)
      expect(s.partnered).toBe(1)
      // The August row, with its 9, must not reach this.
      expect(s.orgasms).toBe(3)
    })

    it('includes both ends of the window', () => {
      expect(summariseIntimacy(logs, '2026-09-01', '2026-09-03').daysLogged).toBe(3)
      expect(summariseIntimacy(logs, '2026-09-02', '2026-09-02').daysLogged).toBe(1)
    })

    it('reports the window length whether or not days were logged', () => {
      expect(summariseIntimacy([], '2026-09-01', '2026-09-30').daysInWindow).toBe(30)
      expect(summariseIntimacy([], '2026-09-01', '2026-09-01').daysInWindow).toBe(1)
    })

    it('averages only the days that recorded desire', () => {
      // An unlogged day is missing information, not a zero.
      const s = summariseIntimacy(logs, '2026-09-01', '2026-09-30')
      expect(s.averageDesire).toBe(3.7)
      expect(s.desireDays).toBe(3)
    })

    it('does not average a day that logged activity but no desire', () => {
      const partial = [log({ logged_on: '2026-09-01', solo: true, orgasms: 1 })]
      const s = summariseIntimacy(partial, '2026-09-01', '2026-09-07')
      expect(s.averageDesire).toBeNull()
      expect(s.desireDays).toBe(0)
      expect(s.solo).toBe(1)
    })

    it('treats a logged zero as a real answer', () => {
      const zero = [log({ logged_on: '2026-09-01', desire: 0 })]
      const s = summariseIntimacy(zero, '2026-09-01', '2026-09-07')
      expect(s.averageDesire).toBe(0)
      expect(s.desireDays).toBe(1)
    })

    it('says nothing rather than zero when the window is empty', () => {
      const s = summariseIntimacy([], '2026-09-01', '2026-09-30')
      expect(s.averageDesire).toBeNull()
      expect(s.daysLogged).toBe(0)
    })
  })

  describe('visibleTips', () => {
    const tips = [
      { id: '1', audience: 'everyone', category: 'lifestyle' },
      { id: '2', audience: 'female', category: 'body' },
      { id: '3', audience: 'male', category: 'body' },
    ] as WellnessTip[]

    it('gives everyone the universal set plus their own', () => {
      expect(visibleTips(tips, { gender: 'female' }).map((t) => t.id)).toEqual(['1', '2'])
      expect(visibleTips(tips, { gender: 'male' }).map((t) => t.id)).toEqual(['1', '3'])
    })

    it('never leaves anyone with an empty screen', () => {
      // `other`, `prefer_not_to_say`, unset and no profile at all.
      for (const gender of ['other', 'prefer_not_to_say', null]) {
        expect(visibleTips(tips, { gender }).map((t) => t.id)).toEqual(['1'])
      }
      expect(visibleTips(tips, null).map((t) => t.id)).toEqual(['1'])
    })

    it('shows everything to anyone who asks, whatever their profile says', () => {
      // The default is a first sort, not a gate.
      expect(visibleTips(tips, { gender: 'male' }, true)).toHaveLength(3)
      expect(visibleTips(tips, null, true)).toHaveLength(3)
    })
  })

  describe('groupTips', () => {
    it('orders the categories and drops the empty ones', () => {
      const tips = [
        { id: '1', category: 'body', audience: 'everyone' },
        { id: '2', category: 'trip_prep', audience: 'everyone' },
      ] as WellnessTip[]
      expect(groupTips(tips).map((g) => g.category)).toEqual(['trip_prep', 'body'])
    })

    it('is empty for no tips rather than a row of empty headings', () => {
      expect(groupTips([])).toEqual([])
    })
  })

  describe('isEmptyLog', () => {
    it('knows an untouched day from a deliberate zero', () => {
      expect(isEmptyLog({ desire: null, solo: false, partnered: false, orgasms: 0, notes: null }))
        .toBe(true)
      expect(isEmptyLog({ desire: 0, solo: false, partnered: false, orgasms: 0, notes: null }))
        .toBe(false)
    })

    it('counts a note on its own as something', () => {
      expect(isEmptyLog({ desire: null, solo: false, partnered: false, orgasms: 0, notes: 'away' }))
        .toBe(false)
      expect(isEmptyLog({ desire: null, solo: false, partnered: false, orgasms: 0, notes: '   ' }))
        .toBe(true)
    })
  })

  it('keeps intimacy as a scope of its own', () => {
    // Sharing a cycle must never imply sharing this.
    expect(SCOPES).toContain('intimacy')
    expect(grantedScopes([], 'them')).not.toContain('intimacy')
  })
})
