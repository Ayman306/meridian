/**
 * Pure functions for Module 10 — Stay Allowance.
 *
 * The spec calls the rolling window "the part people get wrong, and the
 * consequences are severe", so this file is written to be read rather than to
 * be clever. Three conventions decide almost every answer here, and all three
 * are easy to get wrong:
 *
 *   1. Entry day and exit day BOTH count. A same-day in-and-out is one day.
 *   2. The window includes the day being evaluated.
 *   3. "90 in any 180" must hold on EVERY day of a stay, not on arrival. A
 *      trip can be legal the day you land and illegal the day you leave.
 *
 * Everything works on calendar dates as `yyyy-MM-dd` strings. No Date objects,
 * no timezones, no hours — because the rule is about calendar days in the
 * destination, and turning a date into an instant is how an off-by-one
 * appears.
 */
import { addDaysTo, daysBetween, maxDate, minDate, type DateOnly } from '@/lib/dates'
import { countriesCovered } from '@/lib/zones'
import type {
  AllowanceCheck,
  AllowanceRule,
  AllowanceStatus,
  EntryExitLog,
  LogSuggestion,
  OverlapWarning,
  RuleType,
  Stay,
} from './types'

/**
 * The disclaimer required on every screen in this module (spec 10.3).
 *
 * A constant, not a string typed into each component, so it cannot drift and
 * so grepping its name lists every surface that carries it.
 */
export const ALLOWANCE_DISCLAIMER =
  'Advisory only. Rules change and individual circumstances differ. Confirm with the ' +
  "destination's immigration authority before travelling."

/** Below this much headroom the status is worth flagging before a trip. */
export const TIGHT_HEADROOM_DAYS = 7

// ---------------------------------------------------------------------------
// The core count
// ---------------------------------------------------------------------------

/**
 * Days present in the window that ends on `date`, inclusive.
 *
 * Spec 10.3, transcribed. An open-ended stay counts through the evaluation
 * date, which is why a status page's answer changes on its own overnight.
 */
export function daysUsedOn(stays: readonly Stay[], date: DateOnly, windowDays: number): number {
  const windowStart = addDaysTo(date, -(windowDays - 1))
  let count = 0

  for (const stay of stays) {
    const from = maxDate(stay.entered_on, windowStart)
    const to = minDate(stay.exited_on ?? date, date)
    if (!from || !to || to < from) continue
    // +1 because both ends count.
    count += daysBetween(from, to) + 1
  }

  return count
}

/** Days present in a closed span, for the rule types with no rolling window. */
export function daysUsedBetween(
  stays: readonly Stay[],
  from: DateOnly,
  to: DateOnly,
  today: DateOnly,
): number {
  let count = 0
  for (const stay of stays) {
    const start = maxDate(stay.entered_on, from)
    // An open stay is counted to the end of the span or today, whichever is
    // sooner — we know they are there now, not that they will be in December.
    const end = minDate(stay.exited_on ?? today, to)
    if (!start || !end || end < start) continue
    count += daysBetween(start, end) + 1
  }
  return count
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

/**
 * Would this stay breach the limit? Spec 10.3.
 *
 * Every day of the planned stay is evaluated, and the answer is the first day
 * that fails — not the arrival date, which is the check people write by
 * accident and the reason someone gets turned back at a border six weeks in.
 */
export function checkPlannedStay(
  log: readonly Stay[],
  plannedFrom: DateOnly,
  plannedTo: DateOnly,
  rule: AllowanceRule | null,
  today: DateOnly,
): AllowanceCheck {
  if (!rule) {
    return {
      verdict: 'untracked',
      rule: null,
      breachDate: null,
      peak: 0,
      peakDate: null,
      headroom: 0,
      limit: 0,
    }
  }

  if ((rule.rule_type as RuleType) === 'none') {
    return {
      verdict: 'ok',
      rule,
      breachDate: null,
      peak: 0,
      peakDate: null,
      headroom: Number.POSITIVE_INFINITY,
      limit: 0,
    }
  }

  const combined: Stay[] = [...log, { entered_on: plannedFrom, exited_on: plannedTo }]
  const limit = rule.max_days

  let peak = 0
  let peakDate: DateOnly | null = null
  let breachDate: DateOnly | null = null

  for (let d = plannedFrom; d <= plannedTo; d = addDaysTo(d, 1)) {
    const used = usedOnFor(combined, d, rule, today)
    if (used > peak) {
      peak = used
      peakDate = d
    }
    if (used > limit && breachDate === null) breachDate = d
  }

  const headroom = limit - peak
  const verdict =
    breachDate !== null ? 'breach' : headroom <= TIGHT_HEADROOM_DAYS ? 'tight' : 'ok'

  return { verdict, rule, breachDate, peak, peakDate, headroom, limit }
}

/**
 * The count that this rule type asks for, on one day.
 *
 * The four types differ only in which slice of the log they look at, so they
 * share the counting and differ in the window.
 */
export function usedOnFor(
  stays: readonly Stay[],
  date: DateOnly,
  rule: AllowanceRule,
  today: DateOnly,
): number {
  // Merge before counting. Two rows covering one day is common — a same-day
  // hop between Schengen countries produces two honest entries — and counting
  // that day twice would overstate the total against the traveller.
  const merged = mergeStays(stays, date)

  switch (rule.rule_type as RuleType) {
    case 'rolling':
      return daysUsedOn(merged, date, rule.window_days ?? 180)

    case 'per_entry': {
      // The clock restarts on arrival, so only the stay covering this day
      // counts. Merging above means a one-day gap does not restart it, which
      // is the reading that does not let someone reset a limit by stepping
      // across a border and back.
      const current = merged.find((s) => s.entered_on <= date && (s.exited_on ?? date) >= date)
      if (!current) return 0
      const to = minDate(current.exited_on ?? date, date)!
      return daysBetween(current.entered_on, to) + 1
    }

    case 'per_year':
      return daysUsedBetween(merged, `${date.slice(0, 4)}-01-01`, `${date.slice(0, 4)}-12-31`, date)

    case 'per_visa':
      // Counted from the visa's issue date. Without one there is nothing to
      // count from, so the rule cannot be evaluated and reports zero rather
      // than inventing a start.
      return rule.window_start ? daysUsedBetween(merged, rule.window_start, date, today) : 0

    case 'none':
      return 0
  }
}

/**
 * The last day they may stay, if they are there now. Spec 10.3.
 *
 * Walks forward day by day rather than solving for it: the rolling window
 * makes the answer depend on when past stays fall out of it, which is not a
 * subtraction. Capped so a rule someone can never breach — a 'none' rule, or
 * a window they will never fill — terminates instead of spinning.
 *
 * Null means "no date to give": no limit, already past it, or further out than
 * the horizon. Callers show it next to `remaining`, which distinguishes the
 * three — nought remaining and no date is not the same as plenty remaining and
 * no date.
 */
export function mustLeaveBy(
  stays: readonly Stay[],
  rule: AllowanceRule,
  today: DateOnly,
  horizonDays = 400,
): DateOnly | null {
  if ((rule.rule_type as RuleType) === 'none') return null

  // Assume they stay from today onwards; that is what the question means.
  const open = stays.some((s) => s.exited_on === null)
  let d = today

  for (let i = 0; i < horizonDays; i++) {
    const hypothetical: Stay[] = open ? [...stays] : [...stays, { entered_on: today, exited_on: d }]
    if (usedOnFor(hypothetical, d, rule, today) > rule.max_days) {
      // The day before is the last permissible one.
      return i === 0 ? null : addDaysTo(d, -1)
    }
    d = addDaysTo(d, 1)
  }

  return null
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export function statusFor(
  log: readonly EntryExitLog[],
  rule: AllowanceRule,
  today: DateOnly,
): AllowanceStatus {
  const stays = staysForRule(log, rule)
  const used = usedOnFor(stays, today, rule, today)
  const isPresent = stays.some((s) => s.entered_on <= today && s.exited_on === null)

  return {
    rule,
    used,
    remaining: Math.max(0, rule.max_days - used),
    mustLeaveBy: isPresent ? mustLeaveBy(stays, rule, today) : null,
    windowStart:
      (rule.rule_type as RuleType) === 'rolling'
        ? addDaysTo(today, -((rule.window_days ?? 180) - 1))
        : (rule.rule_type as RuleType) === 'per_visa'
          ? rule.window_start
          : null,
    isPresent,
  }
}

/** The log rows that count against a rule — every country the rule covers. */
export function staysForRule(log: readonly EntryExitLog[], rule: AllowanceRule): Stay[] {
  const covered = new Set(countriesCovered(rule.destination_country, rule.region_members))
  return log
    .filter((row) => covered.has(row.country_code.toUpperCase()))
    .map((row) => ({ entered_on: row.entered_on, exited_on: row.exited_on }))
    .sort((a, b) => a.entered_on.localeCompare(b.entered_on))
}

/**
 * The rule that applies to one person in one country.
 *
 * A personal override beats a default, and a country-specific rule beats the
 * zone it belongs to. Null means not tracked, which the UI must render as
 * "not tracked" — never as "no limit" (spec 10.6).
 */
export function ruleFor(
  rules: readonly AllowanceRule[],
  userId: string,
  countryCode: string,
  passports: readonly (string | null)[],
): AllowanceRule | null {
  const country = countryCode.toUpperCase()
  const covers = (rule: AllowanceRule) =>
    countriesCovered(rule.destination_country, rule.region_members).includes(country)

  const overrides = rules.filter((r) => r.user_id === userId && covers(r))
  if (overrides.length > 0) return preferSpecific(overrides, country)

  const owned = new Set(passports.filter(Boolean).map((p) => p!.toUpperCase()))
  const defaults = rules.filter(
    (r) => r.couple_id === null && owned.has(r.passport_country.toUpperCase()) && covers(r),
  )
  return defaults.length > 0 ? preferSpecific(defaults, country) : null
}

function preferSpecific(rules: readonly AllowanceRule[], country: string): AllowanceRule {
  return rules.find((r) => r.destination_country.toUpperCase() === country) ?? rules[0]!
}

// ---------------------------------------------------------------------------
// Log hygiene
// ---------------------------------------------------------------------------

/**
 * Merge stays that touch or overlap, so a day is never counted twice.
 *
 * Two rows covering the same day is usually a data-entry mistake, but even
 * when it is not — a same-day hop between two Schengen countries produces two
 * legitimate rows — counting that day twice would overstate the total against
 * the traveller. Merging is the safe direction to be wrong in.
 */
export function mergeStays(stays: readonly Stay[], openEndsAt: DateOnly): Stay[] {
  const sorted = [...stays].sort((a, b) => a.entered_on.localeCompare(b.entered_on))
  const merged: Stay[] = []

  for (const stay of sorted) {
    const last = merged[merged.length - 1]
    const lastEnd = last ? (last.exited_on ?? openEndsAt) : null

    // Adjacent counts as continuous: leaving on the 5th and re-entering on the
    // 6th is not a break in presence for counting purposes.
    if (last && lastEnd && stay.entered_on <= addDaysTo(lastEnd, 1)) {
      const stayEnd = stay.exited_on ?? openEndsAt
      const stillOpen = last.exited_on === null || stay.exited_on === null
      last.exited_on = stillOpen ? null : maxDate(lastEnd, stayEnd)
      continue
    }

    merged.push({ ...stay })
  }

  return merged
}

/** Pairs of log rows that describe the same days. Surfaced, never silently fixed. */
export function findOverlaps(log: readonly EntryExitLog[], today: DateOnly): OverlapWarning[] {
  const warnings: OverlapWarning[] = []

  for (let i = 0; i < log.length; i++) {
    for (let j = i + 1; j < log.length; j++) {
      const a = log[i]!
      const b = log[j]!
      if (a.user_id !== b.user_id) continue
      const aEnd = a.exited_on ?? today
      const bEnd = b.exited_on ?? today
      if (a.entered_on <= bEnd && b.entered_on <= aEnd) warnings.push({ a, b })
    }
  }

  return warnings
}

/**
 * Stays the app can see in a trip but does not have in the log.
 *
 * Suggested, never inserted — spec 10.2 wants "Add Nov 12 – Dec 5 in Portugal
 * to your log?", and anything auto-written into an immigration record is a
 * fact the app invented about a border crossing.
 */
export function suggestFromTrip(
  trip: {
    id: string
    title: string
    start_date: string | null
    end_date: string | null
    date_precision: string
  },
  countryCode: string | null,
  travellers: readonly { user_id: string; arrival_date: string | null; departure_date: string | null }[],
  log: readonly EntryExitLog[],
): LogSuggestion[] {
  // Only exact dates. A trip pinned to "June" has a start_date of the 1st,
  // and logging that as a border crossing would be a made-up date.
  if (trip.date_precision !== 'exact' || !trip.start_date || !trip.end_date || !countryCode) {
    return []
  }

  const country = countryCode.toUpperCase()

  return travellers.flatMap((traveller) => {
    const from = traveller.arrival_date ?? trip.start_date!
    const to = traveller.departure_date ?? trip.end_date!
    if (to < from) return []

    const already = log.some(
      (row) =>
        row.user_id === traveller.user_id &&
        row.country_code.toUpperCase() === country &&
        row.entered_on <= to &&
        (row.exited_on ?? to) >= from,
    )
    if (already) return []

    return [
      {
        userId: traveller.user_id,
        countryCode: country,
        enteredOn: from,
        exitedOn: to,
        tripId: trip.id,
        tripTitle: trip.title,
      },
    ]
  })
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

export const RULE_TYPE_LABELS: Record<RuleType, string> = {
  rolling: 'Rolling window',
  per_entry: 'Per entry',
  per_year: 'Per calendar year',
  per_visa: 'Per visa',
  none: 'No limit',
}

export function describeRule(rule: AllowanceRule): string {
  switch (rule.rule_type as RuleType) {
    case 'rolling':
      return `${rule.max_days} days in any ${rule.window_days ?? 180}`
    case 'per_entry':
      return `${rule.max_days} days per entry`
    case 'per_year':
      return `${rule.max_days} days per calendar year`
    case 'per_visa':
      return `${rule.max_days} days on this visa`
    case 'none':
      return 'No limit'
  }
}
