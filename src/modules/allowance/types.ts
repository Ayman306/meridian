import type { Tables } from '@/types/database'
import type { DateOnly } from '@/lib/dates'

export type AllowanceRule = Tables<'allowance_rules'>
export type EntryExitLog = Tables<'entry_exit_log'>

export type RuleType = 'rolling' | 'per_entry' | 'per_year' | 'per_visa' | 'none'

/** The shape the arithmetic works on. A log row narrowed to what counts. */
export interface Stay {
  entered_on: DateOnly
  /** Null means still there — counted through the evaluation date. */
  exited_on: DateOnly | null
}

export interface AllowanceStatus {
  rule: AllowanceRule
  /** Days already used, as of the evaluation date. */
  used: number
  remaining: number
  /** The last day they could stay if they were there right now. */
  mustLeaveBy: DateOnly | null
  /** First day of the rolling window. Null for the other rule types. */
  windowStart: DateOnly | null
  /** True while a stay in this country has no exit date. */
  isPresent: boolean
}

export type CheckVerdict = 'ok' | 'tight' | 'breach' | 'untracked'

export interface AllowanceCheck {
  verdict: CheckVerdict
  rule: AllowanceRule | null
  /** The first day the limit would be exceeded. */
  breachDate: DateOnly | null
  /** Worst day of the planned stay and how many days were counted on it. */
  peak: number
  peakDate: DateOnly | null
  headroom: number
  limit: number
}

/** Two log rows describing the same days — almost always a typo (spec 10.6). */
export interface OverlapWarning {
  a: EntryExitLog
  b: EntryExitLog
}

/** A stay the app noticed in a trip and could add to the log for you. */
export interface LogSuggestion {
  userId: string
  countryCode: string
  enteredOn: DateOnly
  exitedOn: DateOnly
  tripId: string
  tripTitle: string
}
