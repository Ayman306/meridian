import type { Tables } from '@/types/database'
import type { DateOnly } from '@/lib/dates'

export type Expense = Tables<'expenses'>
export type Settlement = Tables<'settlements'>
export type Budget = Tables<'budgets'>
export type ExpenseCategory = Tables<'expense_categories'>
export type FxRate = Tables<'fx_rates'>

export type SplitType = 'equal' | 'exact' | 'percent' | 'full'

/** What each person owes for one expense, in the expense's own currency. */
export type Shares = Record<string, number>

/**
 * The two people, in the order the arithmetic uses. `balance()` is signed
 * relative to `a`, so the caller decides who "you" is.
 */
export interface Pair {
  a: string
  b: string
}

export interface Balance {
  /** Positive: b owes a. Negative: a owes b. Zero: square. */
  net: number
  currency: string
  /** Rows that could not be converted, so the number above is incomplete. */
  unconverted: number
}

/** A balance turned into the one sentence the screen shows. */
export interface BalanceLine {
  /** 'square' when the rounded net is zero — never "-0.00". */
  direction: 'owed' | 'owes' | 'square'
  /** Always positive. The direction carries the sign. */
  amount: number
  currency: string
}

export interface CategoryTotal {
  categoryId: string | null
  name: string
  color: string | null
  total: number
  /** Set only where a budget exists for the category. */
  budget: number | null
}

export interface PersonTotal {
  userId: string
  /** What they actually paid out. */
  paid: number
  /** What they were responsible for once the splits are applied. */
  owed: number
}

export interface WeekTotal {
  index: number
  start: DateOnly
  end: DateOnly
  total: number
  /**
   * The weekly budget, when one is set — and the *pro-rata* share of it on a
   * short final week. A trip ending on a Wednesday has a three-day week, and
   * comparing three days of spending against seven days of budget would report
   * every trip as ending under budget.
   */
  budget: number | null
}

export interface DayTotal {
  date: DateOnly
  total: number
}

export interface Summary {
  total: number
  currency: string
  /** Rows saved without a converted amount. Surfaced, never silently dropped. */
  unconverted: number
  byCategory: CategoryTotal[]
  byPerson: PersonTotal[]
  byWeek: WeekTotal[]
  /** The full weekly budget, before any pro-rata on a short week. */
  weeklyBudget: number | null
  byDay: DayTotal[]
  perDayAverage: number
  days: number
}

export interface ExpenseFilters {
  tripId?: string | null
  categoryId?: string | null
  paidBy?: string | null
  from?: DateOnly | null
  to?: DateOnly | null
  search?: string | null
}

/** What a split validation failure has to say to be useful. */
export interface SplitProblem {
  message: string
  /** How far off the sum is, in the expense's currency or in percent. */
  shortfall: number
}
