import { describe, expect, it } from 'vitest'
import {
  balance,
  budgetProgress,
  describeBalance,
  formatMoney,
  fromCents,
  nearestRate,
  round2,
  shares,
  summarise,
  toBase,
  toCents,
  toCsv,
  validateSplit,
  weeksOf,
  worthShowingWeeks,
} from '@/modules/budget/logic'
import type { Budget, Expense, ExpenseCategory, Settlement } from '@/modules/budget/types'

const ADA = 'user-ada'
const BO = 'user-bo'
const PAIR = { a: ADA, b: BO }

const expense = (over: Partial<Expense> = {}): Expense =>
  ({
    id: 'e1',
    couple_id: 'c1',
    trip_id: 't1',
    itinerary_item_id: null,
    description: 'Dinner',
    amount: 60,
    currency: 'EUR',
    amount_base: 60,
    fx_rate: 1,
    fx_date: '2026-06-01',
    paid_by: ADA,
    split_type: 'equal',
    split_detail: null,
    category_id: 'cat-food',
    spent_on: '2026-06-01',
    receipt_media_id: null,
    notes: null,
    created_by: ADA,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    deleted_at: null,
    ...over,
  }) as Expense

const settlement = (over: Partial<Settlement> = {}): Settlement =>
  ({
    id: 's1',
    couple_id: 'c1',
    trip_id: 't1',
    from_user: BO,
    to_user: ADA,
    amount: 30,
    currency: 'USD',
    settled_on: '2026-06-10',
    method: null,
    notes: null,
    created_by: BO,
    created_at: '2026-06-10T00:00:00Z',
    updated_at: '2026-06-10T00:00:00Z',
    deleted_at: null,
    ...over,
  }) as Settlement

const category = (over: Partial<ExpenseCategory> = {}): ExpenseCategory =>
  ({
    id: 'cat-food',
    couple_id: 'c1',
    name: 'Food',
    icon: 'utensils',
    color: '#fb923c',
    sort_order: 3,
    created_by: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  }) as ExpenseCategory

describe('cents', () => {
  it('survives the floats that break naive money code', () => {
    expect(toCents(10.07)).toBe(1007)
    expect(toCents(0.1) + toCents(0.2)).toBe(toCents(0.3))
    expect(round2(0.1 + 0.2)).toBe(0.3)
    expect(fromCents(1007)).toBe(10.07)
  })
})

describe('splits', () => {
  it('halves an even amount', () => {
    expect(shares(expense({ amount: 60 }), PAIR)).toEqual({ [ADA]: 30, [BO]: 30 })
  })

  it('gives the odd cent to the payer and still sums exactly', () => {
    // Spec 13.7's acceptance criterion, stated as arithmetic.
    const result = shares(expense({ amount: 10.01 }), PAIR)
    expect(result[ADA]).toBe(5.01)
    expect(result[BO]).toBe(5.0)
    expect(toCents(result[ADA]!) + toCents(result[BO]!)).toBe(toCents(10.01))
  })

  it('moves the odd cent with the payer', () => {
    const result = shares(expense({ amount: 10.01, paid_by: BO }), PAIR)
    expect(result[BO]).toBe(5.01)
    expect(result[ADA]).toBe(5.0)
  })

  it('creates no debt on a full split', () => {
    const result = shares(expense({ amount: 40, split_type: 'full' }), PAIR)
    expect(result).toEqual({ [ADA]: 40 })
    expect(result[BO]).toBeUndefined()
  })

  it('honours exact shares and gives the payer the remainder', () => {
    const result = shares(
      expense({ amount: 100, split_type: 'exact', split_detail: { [BO]: 30 } }),
      PAIR,
    )
    expect(result[BO]).toBe(30)
    expect(result[ADA]).toBe(70)
  })

  it('turns percentages into amounts that still sum to the total', () => {
    const result = shares(
      expense({ amount: 99.99, split_type: 'percent', split_detail: { [BO]: 33.33 } }),
      PAIR,
    )
    expect(toCents(result[ADA]!) + toCents(result[BO]!)).toBe(toCents(99.99))
  })
})

describe('split validation', () => {
  it('passes the two types that carry no numbers', () => {
    expect(validateSplit('equal', 10, null)).toBeNull()
    expect(validateSplit('full', 10, null)).toBeNull()
  })

  it('accepts an exact split that adds up', () => {
    expect(validateSplit('exact', 100, { [ADA]: 60, [BO]: 40 })).toBeNull()
  })

  it('names the shortfall rather than saying "invalid"', () => {
    const problem = validateSplit('exact', 100, { [ADA]: 60, [BO]: 30 })
    expect(problem?.shortfall).toBe(-10)
    expect(problem?.message).toContain('10.00')
  })

  it('catches an exact split that overshoots', () => {
    expect(validateSplit('exact', 100, { [ADA]: 60, [BO]: 50 })?.shortfall).toBe(10)
  })

  it('requires percentages to reach exactly 100', () => {
    expect(validateSplit('percent', 100, { [ADA]: 50, [BO]: 50 })).toBeNull()
    expect(validateSplit('percent', 100, { [ADA]: 50, [BO]: 49 })?.shortfall).toBe(-1)
    expect(validateSplit('percent', 100, { [ADA]: 33.33, [BO]: 66.67 })).toBeNull()
  })

  it('refuses nonsense', () => {
    expect(validateSplit('exact', 100, {})?.message).toContain('how this one splits')
    expect(validateSplit('exact', 100, { [ADA]: -5, [BO]: 105 })?.message).toContain('negative')
  })
})

describe('balance', () => {
  it('is signed toward a', () => {
    // Ada paid 60, split equally: Bo owes 30.
    const result = balance([expense()], [], PAIR, 'USD')
    expect(result.net).toBe(30)
  })

  it('flips when the other one pays', () => {
    expect(balance([expense({ paid_by: BO })], [], PAIR, 'USD').net).toBe(-30)
  })

  it('creates no debt from a full split', () => {
    expect(balance([expense({ split_type: 'full' })], [], PAIR, 'USD').net).toBe(0)
  })

  it('is zeroed by a settlement', () => {
    // Spec 13.7: "Settlement zeroes the balance".
    const result = balance([expense()], [settlement({ amount: 30 })], PAIR, 'USD')
    expect(result.net).toBe(0)
    expect(describeBalance(result, true).direction).toBe('square')
  })

  it('counts a settlement the other way round', () => {
    const result = balance([], [settlement({ from_user: ADA, to_user: BO, amount: 25 })], PAIR, 'USD')
    expect(result.net).toBe(25)
  })

  it('ignores soft-deleted rows on both sides', () => {
    const result = balance(
      [expense(), expense({ id: 'e2', deleted_at: '2026-06-02T00:00:00Z' })],
      [settlement({ deleted_at: '2026-06-11T00:00:00Z' })],
      PAIR,
      'USD',
    )
    expect(result.net).toBe(30)
  })

  it('reports unconverted rows instead of counting them as zero', () => {
    const result = balance(
      [expense(), expense({ id: 'e2', amount_base: null, fx_rate: null, fx_date: null })],
      [],
      PAIR,
      'USD',
    )
    expect(result.net).toBe(30)
    expect(result.unconverted).toBe(1)
  })

  it('splits the original amount and then scales, so the receipt agrees', () => {
    // €10.01 at 0.9 → $11.12 base. The odd cent belongs to the payer in the
    // currency that was actually spent, not in the converted one.
    const result = balance(
      [expense({ amount: 10.01, currency: 'EUR', amount_base: 11.12, fx_rate: 0.9 })],
      [],
      PAIR,
      'USD',
    )
    // Bo's €5.00 of €10.01 scales to $5.55 of $11.12.
    expect(result.net).toBe(5.55)
  })

  it('does not drift over many rows', () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      expense({ id: `e${i}`, amount: 0.1, amount_base: 0.1 }),
    )
    // 30 × 0.1 = 3.00; each splits 0.05 / 0.05.
    expect(balance(many, [], PAIR, 'USD').net).toBe(1.5)
  })
})

describe('the sentence on the screen', () => {
  it('never says minus zero', () => {
    const line = describeBalance({ net: 0, currency: 'EUR', unconverted: 0 }, true)
    expect(line).toEqual({ direction: 'square', amount: 0, currency: 'EUR' })
  })

  it('reads correctly from either side', () => {
    const result = { net: 142.5, currency: 'EUR', unconverted: 0 }
    expect(describeBalance(result, true)).toEqual({
      direction: 'owed',
      amount: 142.5,
      currency: 'EUR',
    })
    expect(describeBalance(result, false)).toEqual({
      direction: 'owes',
      amount: 142.5,
      currency: 'EUR',
    })
  })

  it('always hands back a positive amount', () => {
    expect(describeBalance({ net: -142.5, currency: 'EUR', unconverted: 0 }, true).amount).toBe(142.5)
  })
})

describe('summary', () => {
  const expenses = [
    expense({ id: 'e1', amount: 60, amount_base: 60, spent_on: '2026-06-01' }),
    expense({
      id: 'e2',
      amount: 40,
      amount_base: 40,
      spent_on: '2026-06-03',
      paid_by: BO,
      category_id: 'cat-stay',
    }),
  ]
  const categories = [category(), category({ id: 'cat-stay', name: 'Stay', color: '#a78bfa' })]

  it('totals, and orders categories by spend', () => {
    const result = summarise(expenses, categories, [], PAIR, 'USD')
    expect(result.total).toBe(100)
    expect(result.byCategory.map((c) => c.name)).toEqual(['Food', 'Stay'])
    expect(result.byCategory[0]!.total).toBe(60)
  })

  it('separates what each paid from what each owed', () => {
    const result = summarise(expenses, categories, [], PAIR, 'USD')
    const ada = result.byPerson.find((p) => p.userId === ADA)!
    const bo = result.byPerson.find((p) => p.userId === BO)!
    expect(ada.paid).toBe(60)
    expect(bo.paid).toBe(40)
    // Both owed half of everything.
    expect(ada.owed).toBe(50)
    expect(bo.owed).toBe(50)
  })

  it('averages over elapsed days, not days with spending', () => {
    // Two spending days, but the span is 1–3 June: three days.
    const result = summarise(expenses, categories, [], PAIR, 'USD')
    expect(result.days).toBe(3)
    expect(result.perDayAverage).toBe(33.33)
  })

  it('uses the trip range when given one, so quiet days still count', () => {
    const result = summarise(expenses, categories, [], PAIR, 'USD', {
      start: '2026-06-01',
      end: '2026-06-10',
    })
    expect(result.days).toBe(10)
    expect(result.perDayAverage).toBe(10)
  })

  it('attaches budgets only where one is set', () => {
    const budgets = [
      { id: 'b1', trip_id: 't1', category_id: 'cat-food', amount: 400, period: 'trip' } as Budget,
    ]
    const result = summarise(expenses, categories, budgets, PAIR, 'USD')
    expect(result.byCategory.find((c) => c.name === 'Food')!.budget).toBe(400)
    expect(result.byCategory.find((c) => c.name === 'Stay')!.budget).toBeNull()
  })

  it('counts unconverted rows separately and leaves them out of the total', () => {
    const result = summarise(
      [...expenses, expense({ id: 'e3', amount: 999, amount_base: null })],
      categories,
      [],
      PAIR,
      'USD',
    )
    expect(result.total).toBe(100)
    expect(result.unconverted).toBe(1)
  })

  it('labels an expense with no category rather than dropping it', () => {
    const result = summarise([expense({ category_id: null })], [], [], PAIR, 'USD')
    expect(result.byCategory[0]!.name).toBe('Uncategorised')
  })

  it('is empty, not broken, with nothing to summarise', () => {
    const result = summarise([], categories, [], PAIR, 'USD')
    expect(result.total).toBe(0)
    expect(result.days).toBe(0)
    expect(result.perDayAverage).toBe(0)
    expect(result.byWeek).toEqual([])
  })
})

describe('per-week view', () => {
  it('counts weeks from day one of the trip, not from Monday', () => {
    const spend = new Map([
      ['2026-06-01', 1000],
      ['2026-06-08', 2000],
    ])
    const weeks = weeksOf('2026-06-01', '2026-06-14', spend)
    expect(weeks).toHaveLength(2)
    expect(weeks[0]).toMatchObject({ index: 1, start: '2026-06-01', end: '2026-06-07', total: 10 })
    expect(weeks[1]).toMatchObject({ index: 2, start: '2026-06-08', end: '2026-06-14', total: 20 })
  })

  it('renders for a 30-night trip, with a short final week', () => {
    // Spec 13.7's acceptance criterion.
    const weeks = weeksOf('2026-06-01', '2026-07-01', new Map())
    expect(weeks).toHaveLength(5)
    expect(weeks[4]).toMatchObject({ index: 5, start: '2026-06-29', end: '2026-07-01' })
  })

  it('is not worth showing for a short trip', () => {
    expect(worthShowingWeeks(6)).toBe(false)
    expect(worthShowingWeeks(14)).toBe(true)
    expect(worthShowingWeeks(31)).toBe(true)
  })
})

describe('fx', () => {
  it('divides by the rate to get back to base', () => {
    // €60 at 0.9 EUR per USD is $66.67.
    expect(toBase(60, 0.9)).toBe(66.67)
    expect(toBase(60, 1)).toBe(60)
  })

  it('refuses a rate that cannot be one', () => {
    expect(() => toBase(10, 0)).toThrow()
    expect(() => toBase(10, -1)).toThrow()
    expect(() => toBase(10, Number.NaN)).toThrow()
  })

  it('falls back to the nearest earlier date, never a later one', () => {
    const rates = [
      { rate_date: '2026-05-28', rate: 0.9 },
      { rate_date: '2026-05-30', rate: 0.92 },
      { rate_date: '2026-06-05', rate: 0.95 },
    ]
    expect(nearestRate(rates, '2026-06-01')?.rate).toBe(0.92)
    expect(nearestRate(rates, '2026-05-30')?.rate).toBe(0.92)
    // Nothing earlier exists, and the later rate is not a substitute.
    expect(nearestRate(rates, '2026-05-01')).toBeNull()
  })

  it('a past expense keeps its converted value when rates move', () => {
    // Spec 13.7. The row carries amount_base, so nothing recomputes it.
    const past = expense({ amount: 60, currency: 'EUR', amount_base: 66.67, fx_rate: 0.9 })
    const before = balance([past], [], PAIR, 'USD').net
    // Rates move; the row does not.
    const after = balance([past], [], PAIR, 'USD').net
    expect(after).toBe(before)
    expect(Number(past.amount_base)).toBe(66.67)
  })
})

describe('csv export', () => {
  const csv = toCsv(
    [expense({ description: 'Dinner, "the good one"', amount: 60, amount_base: 66.67 })],
    [category()],
    { [ADA]: 'Ada' },
    'USD',
  )

  it('quotes and escapes so a comma cannot shift a column', () => {
    expect(csv).toContain('"Dinner, ""the good one"""')
  })

  it('carries both amounts and the rate that links them', () => {
    expect(csv).toContain('"60.00","EUR","66.67"')
  })

  it('starts with a BOM so a spreadsheet reads it as UTF-8', () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff)
  })

  it('leaves out deleted rows', () => {
    const withDeleted = toCsv(
      [expense({ deleted_at: '2026-06-02T00:00:00Z' })],
      [category()],
      {},
      'USD',
    )
    expect(withDeleted.split('\r\n')).toHaveLength(1)
  })
})

describe('formatting', () => {
  it('formats a currency', () => {
    expect(formatMoney(142.5, 'EUR')).toContain('142.50')
  })

  it('does not blank the screen on an unknown code', () => {
    expect(() => formatMoney(10, 'ZZZ')).not.toThrow()
  })

  it('reports budget progress only where a budget exists', () => {
    expect(budgetProgress(200, 400)).toBe(50)
    expect(budgetProgress(500, 400)).toBe(125)
    expect(budgetProgress(200, null)).toBeNull()
    expect(budgetProgress(200, 0)).toBeNull()
  })
})
