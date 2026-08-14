/**
 * Module 13 — Budget. Pure arithmetic, no React and no Supabase.
 *
 * Everything money-shaped in this app goes through this file, for one reason:
 * a balance is a claim about what somebody owes, and it has to be defensible.
 * Two rules make it so.
 *
 * **Money is integer cents here.** `numeric(12,2)` arrives as a JS number and
 * 0.1 + 0.2 is famously not 0.3. Summing thirty expenses in floating point
 * drifts, and the drift lands in the one number a person reads and acts on. So
 * every operation converts to cents, works in integers, and converts back
 * once, at the edge.
 *
 * **Splits are exact.** `shares()` always sums to the total — not to within a
 * cent, exactly to it. The odd cent on an equal split goes to the payer, which
 * is arbitrary but consistent, and consistency is what makes the totals agree
 * with the parts.
 */
import { addDaysTo, dateRange, daysBetween, type DateOnly } from '@/lib/dates'
import { minorUnitsOf } from '@/lib/currencies'
import type {
  Balance,
  BalanceLine,
  Budget,
  CategoryTotal,
  DayTotal,
  Expense,
  ExpenseCategory,
  Pair,
  PersonTotal,
  Settlement,
  Shares,
  SplitProblem,
  SplitType,
  Summary,
  WeekTotal,
} from './types'

// ---------------------------------------------------------------------------
// Cents
// ---------------------------------------------------------------------------

/**
 * A currency amount as an integer number of its smallest unit.
 *
 * `minorUnits` defaults to 2 because that is what almost every currency uses
 * and what the `numeric(12,2)` column stores. Pass the real figure when
 * splitting: yen has none, and halving ¥1,001 into ¥500.50 produces an amount
 * nobody can hand over.
 */
export function toCents(amount: number, minorUnits = 2): number {
  const factor = 10 ** minorUnits
  // Math.round rather than truncation: 10.07 * 100 is 1006.9999999999999.
  return Math.round(amount * factor)
}

export function fromCents(cents: number, minorUnits = 2): number {
  return cents / 10 ** minorUnits
}

/** Round a currency amount to 2dp without the usual float surprises. */
export function round2(amount: number): number {
  return fromCents(toCents(amount))
}

// ---------------------------------------------------------------------------
// Splits
// ---------------------------------------------------------------------------

/**
 * What each person owes for one expense, in the expense's own currency.
 *
 * The result always sums to the expense total exactly. Where a division leaves
 * a remainder, the payer absorbs it: they are the one out of pocket, so
 * rounding in their favour is the reading that never leaves the other person
 * owing a cent they did not agree to.
 */
export function shares(expense: Expense, pair: Pair): Shares {
  // The currency the money was actually spent in decides the precision. An
  // odd yen goes to the payer whole, exactly as an odd cent does.
  const units = minorUnitsOf(expense.currency)
  const toUnits = (n: number) => toCents(n, units)
  const fromUnits = (n: number) => fromCents(n, units)

  const total = toUnits(Number(expense.amount))
  const payer = expense.paid_by
  const other = payer === pair.a ? pair.b : pair.a
  const detail = (expense.split_detail ?? {}) as Record<string, number>

  switch (expense.split_type as SplitType) {
    case 'full':
      // The payer covers it entirely. No debt is created, which is the whole
      // point of the option — it still counts toward trip totals.
      return { [payer]: fromUnits(total) }

    case 'exact': {
      // Trusted only after `validateSplit`. Whatever is unaccounted for goes
      // to the payer, so the shares still sum to the total.
      const out: Shares = {}
      let assigned = 0
      for (const [userId, value] of Object.entries(detail)) {
        if (userId === payer) continue
        const units_ = toUnits(Number(value))
        out[userId] = fromUnits(units_)
        assigned += units_
      }
      out[payer] = fromUnits(total - assigned)
      return out
    }

    case 'percent': {
      const out: Shares = {}
      let assigned = 0
      for (const [userId, value] of Object.entries(detail)) {
        if (userId === payer) continue
        const units_ = Math.round((total * Number(value)) / 100)
        out[userId] = fromUnits(units_)
        assigned += units_
      }
      out[payer] = fromUnits(total - assigned)
      return out
    }

    case 'equal':
    default: {
      const half = Math.floor(total / 2)
      // The odd unit to the payer. €10.01 becomes 5.01 / 5.00, ¥1,001 becomes
      // ¥500 / ¥501, and each pair still adds to the total — the acceptance
      // criterion in spec 13.7.
      return { [other]: fromUnits(half), [payer]: fromUnits(total - half) }
    }
  }
}

/**
 * Whether a split can be saved. Returns null when it can.
 *
 * Spec 13.3 is explicit that this rejects rather than rounds: "silent rounding
 * errors compound". The message names the shortfall because "invalid split" is
 * not something a person can act on.
 */
export function validateSplit(
  splitType: SplitType,
  amount: number,
  detail: Record<string, number> | null | undefined,
): SplitProblem | null {
  if (splitType === 'equal' || splitType === 'full') return null

  const values = Object.values(detail ?? {})
  if (values.length === 0) {
    return { message: 'Enter how this one splits.', shortfall: 0 }
  }
  if (values.some((v) => !Number.isFinite(Number(v)) || Number(v) < 0)) {
    return { message: 'Every share has to be a number, and none can be negative.', shortfall: 0 }
  }

  if (splitType === 'exact') {
    const sum = values.reduce((acc, v) => acc + toCents(Number(v)), 0)
    const target = toCents(amount)
    const diff = sum - target
    if (diff === 0) return null
    const over = diff > 0
    return {
      message: over
        ? `That is ${fromCents(diff).toFixed(2)} more than the total.`
        : `That leaves ${fromCents(-diff).toFixed(2)} unaccounted for.`,
      shortfall: fromCents(diff),
    }
  }

  // percent
  const sum = values.reduce((acc, v) => acc + Math.round(Number(v) * 100), 0)
  const diff = sum - 10_000
  if (diff === 0) return null
  return {
    message:
      diff > 0
        ? `Those add up to ${(sum / 100).toFixed(2)}%, which is over 100.`
        : `Those add up to ${(sum / 100).toFixed(2)}%, which is under 100.`,
    shortfall: diff / 100,
  }
}

// ---------------------------------------------------------------------------
// Balance
// ---------------------------------------------------------------------------

/**
 * Who owes whom, in the base currency.
 *
 * Reads `amount_base` and never converts — spec 13.3: "All arithmetic in the
 * base currency, using each expense's stored amount_base. Never convert at
 * read time." A row that has not been converted yet is counted in
 * `unconverted` and left out of the sum, because guessing at it would be worse
 * than admitting the total is provisional.
 *
 * The shares are computed on the *original* amount and then scaled to base,
 * rather than splitting the base amount directly. Splitting after conversion
 * would put the odd cent somewhere the receipt does not agree with.
 */
export function balance(
  expenses: Expense[],
  settlements: Settlement[],
  pair: Pair,
  currency: string,
): Balance {
  let net = 0 // cents; positive means b owes a
  let unconverted = 0

  for (const expense of expenses) {
    if (expense.deleted_at) continue
    if (expense.amount_base === null) {
      unconverted += 1
      continue
    }
    if (expense.split_type === 'full') continue

    const inOriginal = shares(expense, pair)
    const originalTotal = toCents(Number(expense.amount))
    const baseTotal = toCents(Number(expense.amount_base))

    // Scale each share by the same ratio the row was converted at, then give
    // the payer the remainder so the parts still sum to `amount_base`.
    const counterparty = expense.paid_by === pair.a ? pair.b : pair.a
    const theirShare = toCents(inOriginal[counterparty] ?? 0)
    const theirBase =
      originalTotal === 0 ? 0 : Math.round((theirShare * baseTotal) / originalTotal)

    if (expense.paid_by === pair.a) net += theirBase
    else net -= theirBase
  }

  for (const settled of settlements) {
    if (settled.deleted_at) continue
    const amount = toCents(Number(settled.amount))
    // b paying a reduces what b owes a.
    if (settled.from_user === pair.b) net -= amount
    else if (settled.from_user === pair.a) net += amount
  }

  return { net: fromCents(net), currency, unconverted }
}

/**
 * The one sentence the screen shows.
 *
 * Spec 13.6: never "-€0.00". A net that rounds to zero is square, and the
 * amount handed back is always positive — the direction carries the sign.
 */
export function describeBalance(result: Balance, viewerIsA: boolean): BalanceLine {
  const cents = toCents(result.net)
  if (cents === 0) return { direction: 'square', amount: 0, currency: result.currency }

  // Positive net means b owes a.
  const viewerIsOwed = viewerIsA ? cents > 0 : cents < 0
  return {
    direction: viewerIsOwed ? 'owed' : 'owes',
    amount: fromCents(Math.abs(cents)),
    currency: result.currency,
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

/**
 * Everything the trip summary screen needs, in one pass.
 *
 * `byWeek` exists because spec 13.2 asks for it by name: "a month-long total
 * is hard to reason about". Weeks are counted from the trip's first day rather
 * than from calendar Mondays — on a trip, "week two" means the second week of
 * the trip, not whatever the calendar says.
 */
export function summarise(
  expenses: Expense[],
  categories: ExpenseCategory[],
  budgets: Budget[],
  pair: Pair,
  currency: string,
  range?: { start: DateOnly; end: DateOnly } | null,
): Summary {
  const live = expenses.filter((e) => !e.deleted_at)
  const converted = live.filter((e) => e.amount_base !== null)
  const unconverted = live.length - converted.length

  let total = 0
  const categoryCents = new Map<string | null, number>()
  const dayCents = new Map<DateOnly, number>()
  const paidCents = new Map<string, number>()
  const owedCents = new Map<string, number>()

  for (const expense of converted) {
    const baseTotal = toCents(Number(expense.amount_base))
    const originalTotal = toCents(Number(expense.amount))
    total += baseTotal

    categoryCents.set(
      expense.category_id,
      (categoryCents.get(expense.category_id) ?? 0) + baseTotal,
    )
    dayCents.set(expense.spent_on, (dayCents.get(expense.spent_on) ?? 0) + baseTotal)
    paidCents.set(expense.paid_by, (paidCents.get(expense.paid_by) ?? 0) + baseTotal)

    // Responsibility, in base, scaled the same way `balance` scales it.
    const inOriginal = shares(expense, pair)
    let assigned = 0
    const others = Object.keys(inOriginal).filter((id) => id !== expense.paid_by)
    for (const userId of others) {
      const scaled =
        originalTotal === 0
          ? 0
          : Math.round((toCents(inOriginal[userId] ?? 0) * baseTotal) / originalTotal)
      owedCents.set(userId, (owedCents.get(userId) ?? 0) + scaled)
      assigned += scaled
    }
    owedCents.set(expense.paid_by, (owedCents.get(expense.paid_by) ?? 0) + (baseTotal - assigned))
  }

  const budgetFor = new Map<string | null, number>()
  for (const budget of budgets) {
    if (budget.period !== 'trip') continue
    budgetFor.set(budget.category_id, toCents(Number(budget.amount)))
  }

  const byCategory: CategoryTotal[] = [...categoryCents.entries()]
    .map(([categoryId, cents]) => {
      const category = categories.find((c) => c.id === categoryId)
      const budgeted = budgetFor.get(categoryId)
      return {
        categoryId,
        name: category?.name ?? 'Uncategorised',
        color: category?.color ?? null,
        total: fromCents(cents),
        budget: budgeted === undefined ? null : fromCents(budgeted),
      }
    })
    .sort((x, y) => y.total - x.total)

  const people = new Set([...paidCents.keys(), ...owedCents.keys(), pair.a, pair.b])
  const byPerson: PersonTotal[] = [...people].map((userId) => ({
    userId,
    paid: fromCents(paidCents.get(userId) ?? 0),
    owed: fromCents(owedCents.get(userId) ?? 0),
  }))

  const byDay: DayTotal[] = [...dayCents.entries()]
    .map(([date, cents]) => ({ date, total: fromCents(cents) }))
    .sort((x, y) => x.date.localeCompare(y.date))

  const span = spanOf(byDay, range)
  const days = span ? daysBetween(span.start, span.end) + 1 : 0

  return {
    total: fromCents(total),
    currency,
    unconverted,
    byCategory,
    byPerson,
    byDay,
    byWeek: span ? weeksOf(span.start, span.end, dayCents) : [],
    // Per *elapsed* day, not per day with spending — a zero-spend day is still
    // a day of the trip, and averaging it away flatters the number.
    perDayAverage: days > 0 ? fromCents(Math.round(total / days)) : 0,
    days,
  }
}

function spanOf(
  byDay: DayTotal[],
  range?: { start: DateOnly; end: DateOnly } | null,
): { start: DateOnly; end: DateOnly } | null {
  if (range?.start && range.end) return range
  if (byDay.length === 0) return null
  return { start: byDay[0]!.date, end: byDay[byDay.length - 1]!.date }
}

/** Trip weeks, counted from day one. Week 1 is days 1–7. */
export function weeksOf(
  start: DateOnly,
  end: DateOnly,
  dayCents: Map<DateOnly, number>,
): WeekTotal[] {
  const out: WeekTotal[] = []
  const totalDays = daysBetween(start, end) + 1
  for (let index = 0; index * 7 < totalDays; index += 1) {
    const weekStart = addDaysTo(start, index * 7)
    const lastIndex = Math.min(index * 7 + 6, totalDays - 1)
    const weekEnd = addDaysTo(start, lastIndex)
    let cents = 0
    for (const date of dateRange(weekStart, weekEnd)) cents += dayCents.get(date) ?? 0
    out.push({ index: index + 1, start: weekStart, end: weekEnd, total: fromCents(cents) })
  }
  return out
}

/**
 * Whether the per-week view is worth showing at all. Under a fortnight it is
 * two bars and less legible than the daily line it replaces.
 */
export function worthShowingWeeks(days: number): boolean {
  return days >= 14
}

// ---------------------------------------------------------------------------
// FX
// ---------------------------------------------------------------------------

/**
 * Apply a rate to an amount.
 *
 * `rate` is quote-per-base — how many units of the expense's currency one unit
 * of base buys — so converting back into base divides. Named and documented
 * because getting the direction backwards produces plausible-looking numbers
 * that are wrong by a factor of the rate squared.
 */
export function toBase(amount: number, rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('A rate must be a positive number.')
  return fromCents(Math.round(toCents(amount) / rate))
}

/**
 * The nearest usable cached rate for a date.
 *
 * Falls back to the nearest *earlier* date and never a later one: a rate that
 * had not happened yet when the money was spent is not the rate that applied.
 * Spec 13.3's fallback chain, minus the network call.
 */
export function nearestRate(
  rates: { rate_date: string; rate: number }[],
  on: DateOnly,
): { rate_date: string; rate: number } | null {
  let best: { rate_date: string; rate: number } | null = null
  for (const candidate of rates) {
    if (candidate.rate_date > on) continue
    if (!best || candidate.rate_date > best.rate_date) best = candidate
  }
  return best
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/** RFC 4180: quote everything, double the quotes inside. */
function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return `"${text.replace(/"/g, '""')}"`
}

/**
 * A trip's expenses as CSV.
 *
 * Both amounts on every row — the original and the base — plus the rate that
 * links them, so the sheet can be checked by hand. A converted number with no
 * rate beside it is unauditable.
 */
export function toCsv(
  expenses: Expense[],
  categories: ExpenseCategory[],
  names: Record<string, string>,
  baseCurrency: string,
): string {
  const header = [
    'Date',
    'Description',
    'Category',
    'Amount',
    'Currency',
    `Amount (${baseCurrency})`,
    'Rate',
    'Rate date',
    'Paid by',
    'Split',
    'Notes',
  ]
  const rows = expenses
    .filter((e) => !e.deleted_at)
    .sort((x, y) => x.spent_on.localeCompare(y.spent_on))
    .map((e) => [
      e.spent_on,
      e.description,
      categories.find((c) => c.id === e.category_id)?.name ?? '',
      Number(e.amount).toFixed(2),
      e.currency,
      e.amount_base === null ? '' : Number(e.amount_base).toFixed(2),
      e.fx_rate === null ? '' : String(e.fx_rate),
      e.fx_date ?? '',
      names[e.paid_by] ?? '',
      e.split_type,
      e.notes ?? '',
    ])

  // A leading BOM so Excel reads it as UTF-8 rather than the local codepage,
  // which is the difference between "Café" and "CafÃ©" in the one place a
  // person is most likely to notice.
  return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const FORMATTERS = new Map<string, Intl.NumberFormat>()

/** Currency formatting, memoised — `Intl.NumberFormat` is expensive to build. */
export function formatMoney(amount: number, currency: string, locale = 'en-GB'): string {
  const key = `${locale}:${currency}`
  let formatter = FORMATTERS.get(key)
  if (!formatter) {
    try {
      formatter = new Intl.NumberFormat(locale, { style: 'currency', currency })
    } catch {
      // An unknown code should not blank the screen.
      formatter = new Intl.NumberFormat(locale, { minimumFractionDigits: 2 })
    }
    FORMATTERS.set(key, formatter)
  }
  return formatter.format(amount)
}

/** Percent of budget used, or null when nothing was budgeted. */
export function budgetProgress(total: number, budget: number | null): number | null {
  if (budget === null || budget <= 0) return null
  return Math.round((total / budget) * 100)
}
