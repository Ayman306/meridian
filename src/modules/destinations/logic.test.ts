import { describe, expect, it } from 'vitest'
import {
  VISA_FRICTION,
  bestVisaRule,
  buildBoard,
  chosenDestination,
  combinedFriction,
  exclusionReason,
  fairness,
  findVisaRule,
  flightEstimate,
  isEqualDistance,
  normalise,
  parseWeights,
  rankColumns,
  scoreColumns,
  scoringEnabled,
  sortDestinations,
  tripMonth,
  ZERO_WEIGHTS,
  type Traveller,
} from '@/modules/destinations/logic'
import { seasonBand } from '@/modules/destinations/climate'
import { costBand } from '@/modules/destinations/cost'
import type { BoardColumn, PersonView, TripDestination, VisaRule } from '@/modules/destinations/types'

let seq = 0
const destination = (over: Partial<TripDestination> = {}): TripDestination => ({
  id: `d${++seq}`,
  couple_id: 'c1',
  trip_id: 't1',
  city: 'Lisbon',
  country_code: 'PT',
  lat: 38.72,
  lng: -9.14,
  timezone: 'Europe/Lisbon',
  state: 'candidate',
  arrive_on: null,
  depart_on: null,
  sort_key: 'a0',
  notes: null,
  board: {},
  created_by: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  deleted_at: null,
  ...over,
})

const visa = (over: Partial<VisaRule> = {}): VisaRule => ({
  id: `v${++seq}`,
  passport_country: 'US',
  destination_country: 'SCHENGEN',
  tier: 0,
  label: 'Visa-free',
  max_days: 90,
  source_url: 'https://example.test',
  verified_on: '2026-01-01',
  ...over,
})

const view = (over: Partial<PersonView> = {}): PersonView => ({
  userId: 'me',
  flight: { hours: 5, isEstimated: true },
  visa: null,
  isHome: false,
  passport: 'US',
  ...over,
})

describe('findVisaRule', () => {
  const rules = [
    visa({ passport_country: 'US', destination_country: 'SCHENGEN', tier: 0 }),
    visa({ passport_country: 'US', destination_country: 'PT', tier: 1, label: 'Country rule' }),
  ]

  it('prefers a country rule over the zone it belongs to', () => {
    expect(findVisaRule(rules, 'US', 'PT', 'SCHENGEN')?.label).toBe('Country rule')
  })

  it('falls back to the zone rule', () => {
    expect(findVisaRule(rules, 'US', 'ES', 'SCHENGEN')?.tier).toBe(0)
  })

  it('finds nothing for an unlisted pair', () => {
    expect(findVisaRule(rules, 'US', 'BR', null)).toBeNull()
  })
})

describe('bestVisaRule', () => {
  const rules = [
    visa({ passport_country: 'IN', destination_country: 'SCHENGEN', tier: 3 }),
    visa({ passport_country: 'GB', destination_country: 'SCHENGEN', tier: 0 }),
  ]

  it('takes the easier of two passports and says which', () => {
    const { rule, passport } = bestVisaRule(rules, ['IN', 'GB'], 'PT', 'SCHENGEN')
    expect(rule?.tier).toBe(0)
    expect(passport).toBe('GB')
  })

  it('returns nothing when neither passport has a rule', () => {
    expect(bestVisaRule(rules, ['NZ'], 'PT', 'SCHENGEN').rule).toBeNull()
  })
})

describe('combinedFriction', () => {
  it('adds both partners up', () => {
    const people = [view({ visa: visa({ tier: 0 }) }), view({ visa: visa({ tier: 2 }) })]
    expect(combinedFriction(people)).toBe(VISA_FRICTION[0] + VISA_FRICTION[2])
  })

  it('charges an unknown rule as much as an embassy appointment', () => {
    // Never zero. Treating a missing row as visa-free is the mistake the
    // module exists to prevent.
    expect(combinedFriction([view({ visa: null })])).toBe(VISA_FRICTION[3])
  })

  it('costs nothing for the partner whose home country it is', () => {
    expect(combinedFriction([view({ isHome: true, visa: null })])).toBe(0)
  })
})

describe('exclusionReason', () => {
  it('rules a destination out when either passport is tier 5', () => {
    const people = [view(), view({ visa: visa({ tier: 5, label: 'No entry permitted' }) })]
    expect(exclusionReason(people)).toContain('No entry permitted')
  })

  it('is null when both can get in', () => {
    expect(exclusionReason([view({ visa: visa({ tier: 3 }) })])).toBeNull()
  })
})

describe('flightEstimate', () => {
  it('uses a cached duration and marks it as known', () => {
    expect(flightEstimate(null, null, 330)).toEqual({ hours: 5.5, isEstimated: false })
  })

  it('estimates from the great circle and says so', () => {
    // London to Lisbon, roughly 1600 km.
    const result = flightEstimate({ lat: 51.5, lng: -0.13 }, { lat: 38.72, lng: -9.14 }, null)
    expect(result?.isEstimated).toBe(true)
    expect(result!.hours).toBeGreaterThan(2)
    expect(result!.hours).toBeLessThan(3.5)
  })

  it('gives nothing without coordinates', () => {
    expect(flightEstimate(null, { lat: 1, lng: 1 }, null)).toBeNull()
  })
})

describe('fairness', () => {
  it('calls a two-hour gap balanced', () => {
    const result = fairness([
      view({ userId: 'a', flight: { hours: 4, isEstimated: true } }),
      view({ userId: 'b', flight: { hours: 5.5, isEstimated: true } }),
    ])
    expect(result?.kind).toBe('balanced')
  })

  it('names who is flying further', () => {
    const result = fairness([
      view({ userId: 'a', flight: { hours: 2, isEstimated: true } }),
      view({ userId: 'b', flight: { hours: 14, isEstimated: true } }),
    ])
    expect(result?.kind).toBe('heavy')
    expect(result?.towards).toBe('b')
  })

  it('bands the middle cases', () => {
    const at = (diff: number) =>
      fairness([
        view({ userId: 'a', flight: { hours: 1, isEstimated: true } }),
        view({ userId: 'b', flight: { hours: 1 + diff, isEstimated: true } }),
      ])?.kind
    expect(at(3)).toBe('slight')
    expect(at(7)).toBe('skewed')
  })

  it('needs two flights to say anything', () => {
    expect(fairness([view()])).toBeNull()
    expect(fairness([view(), view({ userId: 'b', flight: null })])).toBeNull()
  })
})

describe('tripMonth', () => {
  it('reads the month from an exact date', () => {
    expect(tripMonth('2026-06-14', 'exact')).toBe(6)
  })

  it('refuses to read a month out of a vague date', () => {
    // A trip pinned to "2027" is stored as 1 January. Answering "January"
    // would be a fact invented from a placeholder.
    expect(tripMonth('2027-01-01', 'year')).toBeNull()
    expect(tripMonth('2027-01-01', 'season')).toBeNull()
    expect(tripMonth(null, 'exact')).toBeNull()
  })
})

describe('seasonBand', () => {
  it('answers for a country in the table', () => {
    expect(seasonBand('PT', 7)).toBe('hot')
  })

  it('says nothing for a country that is not', () => {
    expect(seasonBand('ZZ', 7)).toBeNull()
    expect(seasonBand('PT', null)).toBeNull()
  })
})

describe('normalise', () => {
  it('scales across the set', () => {
    expect(normalise([0, 5, 10])).toEqual([0, 0.5, 1])
  })

  it('puts an unknown in the middle so it neither helps nor hurts', () => {
    expect(normalise([0, null, 10])[1]).toBe(0.5)
  })

  it('scores an all-equal set as equally good', () => {
    expect(normalise([4, 4, 4])).toEqual([1, 1, 1])
  })

  it('has nothing to say about an empty set', () => {
    expect(normalise([null, null])).toEqual([0.5, 0.5])
  })
})

describe('scoring', () => {
  const columns: BoardColumn[] = [
    {
      destination: destination({ city: 'Lisbon', country_code: 'PT' }),
      people: [
        view({ userId: 'a', flight: { hours: 3, isEstimated: true }, visa: visa({ tier: 0 }) }),
        view({ userId: 'b', flight: { hours: 3, isEstimated: true }, visa: visa({ tier: 0 }) }),
      ],
      fairness: { kind: 'balanced', diff: 0, towards: null },
      band: 'mild',
      wishlistCount: 8,
      excluded: null,
      score: null,
    },
    {
      destination: destination({ city: 'Tokyo', country_code: 'JP' }),
      people: [
        view({ userId: 'a', flight: { hours: 13, isEstimated: true }, visa: visa({ tier: 3 }) }),
        view({ userId: 'b', flight: { hours: 2, isEstimated: true }, visa: visa({ tier: 0 }) }),
      ],
      fairness: { kind: 'heavy', diff: 11, towards: 'a' },
      band: 'rainy',
      wishlistCount: 0,
      excluded: null,
      score: null,
    },
  ]

  it('stays off until a weight moves', () => {
    expect(scoringEnabled(ZERO_WEIGHTS)).toBe(false)
    expect(scoreColumns(columns, ZERO_WEIGHTS, costBand)).toEqual([null, null])
  })

  it('ranks the closer, easier city above the far one', () => {
    const weights = { ...ZERO_WEIGHTS, hours: 1, fairness: 1, visa: 1 }
    const scores = scoreColumns(columns, weights, costBand)
    expect(scores[0]!.total).toBeGreaterThan(scores[1]!.total)
  })

  it('always carries the breakdown, never a bare number', () => {
    const scores = scoreColumns(columns, { ...ZERO_WEIGHTS, hours: 1 }, costBand)
    expect(scores[0]!.parts).toHaveLength(6)
    expect(scores[0]!.parts.find((p) => p.key === 'hours')!.weight).toBe(1)
  })

  it('sorts the highest score first', () => {
    const scored = columns.map((c, i) => ({
      ...c,
      score: { total: i === 0 ? 0.2 : 0.9, parts: [] },
    }))
    expect(rankColumns(scored)[0]!.destination.city).toBe('Tokyo')
  })
})

describe('parseWeights', () => {
  it('reads a stored object and clamps it', () => {
    expect(parseWeights({ hours: 0.5, visa: 3, cost: -1 })).toMatchObject({
      hours: 0.5,
      visa: 1,
      cost: 0,
    })
  })

  it('falls back to all-zero on junk', () => {
    expect(parseWeights(null)).toEqual(ZERO_WEIGHTS)
    expect(parseWeights('nope')).toEqual(ZERO_WEIGHTS)
  })
})

describe('buildBoard', () => {
  const travellers: Traveller[] = [
    { userId: 'a', home: { lat: 51.5, lng: -0.13 }, passports: ['GB'] },
    { userId: 'b', home: { lat: 28.6, lng: 77.2 }, passports: ['IN'] },
  ]
  const rules = [
    visa({ passport_country: 'GB', destination_country: 'SCHENGEN', tier: 0 }),
    visa({ passport_country: 'IN', destination_country: 'SCHENGEN', tier: 3 }),
  ]

  const board = (destinations: TripDestination[], month: number | null = 6) =>
    buildBoard({
      destinations,
      travellers,
      visaRules: rules,
      wishlistCountFor: () => 2,
      month,
      weights: ZERO_WEIGHTS,
    })

  it('renders one candidate', () => {
    const columns = board([destination()])
    expect(columns).toHaveLength(1)
    expect(columns[0]!.people).toHaveLength(2)
    expect(columns[0]!.band).toBe('warm')
  })

  it('renders five', () => {
    const cities = ['Lisbon', 'Porto', 'Madrid', 'Rome', 'Athens']
    expect(board(cities.map((city) => destination({ city })))).toHaveLength(5)
  })

  it('resolves each partner’s visa through the zone', () => {
    const [column] = board([destination({ country_code: 'ES' })])
    expect(column!.people.find((p) => p.userId === 'a')!.visa?.tier).toBe(0)
    expect(column!.people.find((p) => p.userId === 'b')!.visa?.tier).toBe(3)
  })

  it('marks a partner’s own country as home rather than a visa tier', () => {
    const [column] = board([destination({ city: 'Delhi', country_code: 'IN' })])
    const them = column!.people.find((p) => p.userId === 'b')!
    expect(them.isHome).toBe(true)
    expect(them.visa).toBeNull()
  })

  it('leaves the season blank when the trip has no month', () => {
    expect(board([destination()], null)[0]!.band).toBeNull()
  })

  it('estimates both flights from the candidate’s coordinates', () => {
    const [column] = board([destination()])
    for (const person of column!.people) {
      expect(person.flight?.isEstimated).toBe(true)
      expect(person.flight!.hours).toBeGreaterThan(0)
    }
  })
})

describe('the equal-distance lens', () => {
  it('keeps only candidates within two hours of each other', () => {
    const near = { fairness: { kind: 'balanced', diff: 1.5, towards: 'a' } } as BoardColumn
    const far = { fairness: { kind: 'skewed', diff: 6, towards: 'a' } } as BoardColumn
    expect(isEqualDistance(near)).toBe(true)
    expect(isEqualDistance(far)).toBe(false)
  })
})

describe('sortDestinations', () => {
  it('puts the chosen first and keeps rejections visible at the end', () => {
    const rows = [
      destination({ city: 'Rejected', state: 'rejected', sort_key: 'a0' }),
      destination({ city: 'Candidate', state: 'candidate', sort_key: 'a1' }),
      destination({ city: 'Chosen', state: 'chosen', sort_key: 'a2' }),
    ]
    expect(sortDestinations(rows).map((d) => d.city)).toEqual(['Chosen', 'Candidate', 'Rejected'])
  })

  it('finds the chosen one, or nothing', () => {
    expect(chosenDestination([destination({ state: 'candidate' })])).toBeNull()
    expect(chosenDestination([destination({ state: 'chosen', city: 'Porto' })])?.city).toBe('Porto')
  })
})
