/**
 * ALL timezone logic lives here. See spec 0.5.
 *
 * The rules, no exceptions:
 *  1. Instants are stored as `timestamptz` (UTC) and are real moments in time.
 *  2. Calendar dates (trip start, document expiry, cycle start) are stored as
 *     `date` and are NOT moments — never convert them to timestamps.
 *  3. Conversion to a viewer's timezone happens at render time, only here.
 *  4. Profiles store an IANA zone string ("America/Toronto"), never an offset.
 *
 * The distinction that causes the most bugs:
 *  - Itinerary items store trip-local wall-clock time. "Dinner at 8pm" means 8pm
 *    where they are. Stored as scheduled_date + start_time, read in the trip's tz.
 *  - Flights store UTC, because a flight departs at an absolute instant.
 */
import {
  addDays,
  differenceInCalendarDays,
  differenceInMonths,
  eachDayOfInterval,
  format,
  isValid,
  parseISO,
  startOfDay,
} from 'date-fns'
import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz'

/** A calendar date with no time component, as `yyyy-MM-dd`. */
export type DateOnly = string
/** A wall-clock time with no date, as `HH:mm` or `HH:mm:ss`. */
export type TimeOnly = string

export const ISO_DATE = 'yyyy-MM-dd'

// ---------------------------------------------------------------------------
// Calendar dates — never touch a timezone
// ---------------------------------------------------------------------------

/**
 * Parse a `yyyy-MM-dd` string into a Date anchored at local midnight.
 * Used only so date-fns calendar helpers can operate on it; the result must
 * never be serialised back as an instant.
 */
export function parseDateOnly(date: DateOnly): Date {
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) throw new Error(`Invalid DateOnly: ${date}`)
  return new Date(y, m - 1, d)
}

export function toDateOnly(d: Date): DateOnly {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function isValidDateOnly(value: string | null | undefined): value is DateOnly {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = parseISO(value)
  return isValid(parsed)
}

/** Today's calendar date in a given IANA zone. */
export function todayIn(tz: string): DateOnly {
  return formatInTimeZone(new Date(), tz, ISO_DATE)
}

/**
 * Whole calendar days between two dates. Positive when `to` is later.
 * DST-safe: operates on calendar days, not elapsed milliseconds.
 */
export function daysBetween(from: DateOnly, to: DateOnly): number {
  return differenceInCalendarDays(parseDateOnly(to), parseDateOnly(from))
}

/**
 * Nights between two calendar dates. 12th–16th is 4 nights / 5 days —
 * users think in nights for accommodation and days for planning, so callers
 * should usually show both.
 */
export function nightsBetween(start: DateOnly, end: DateOnly): number {
  return Math.max(0, daysBetween(start, end))
}

/** Inclusive list of every calendar date in a range. */
export function dateRange(start: DateOnly, end: DateOnly): DateOnly[] {
  if (daysBetween(start, end) < 0) return []
  return eachDayOfInterval({ start: parseDateOnly(start), end: parseDateOnly(end) }).map(toDateOnly)
}

export function addDaysTo(date: DateOnly, amount: number): DateOnly {
  return toDateOnly(addDays(parseDateOnly(date), amount))
}

/**
 * Render a calendar date for reading.
 *
 * No timezone is involved and none may be: a `date` is not a moment, so
 * converting it into one to format it is exactly the bug rule 2 above exists to
 * prevent. It formats the local-midnight Date that `parseDateOnly` builds, which
 * is the only reason that Date exists.
 */
export function formatDateOnly(date: DateOnly, pattern: string): string {
  return format(parseDateOnly(date), pattern)
}

/** Whole months from `from` until `to`. Used by the passport 6/9-month rules. */
export function monthsUntil(to: DateOnly, from: DateOnly): number {
  return differenceInMonths(parseDateOnly(to), parseDateOnly(from))
}

export function maxDate(...dates: (DateOnly | null | undefined)[]): DateOnly | null {
  const valid = dates.filter(isValidDateOnly)
  return valid.length ? valid.reduce((a, b) => (a > b ? a : b)) : null
}

export function minDate(...dates: (DateOnly | null | undefined)[]): DateOnly | null {
  const valid = dates.filter(isValidDateOnly)
  return valid.length ? valid.reduce((a, b) => (a < b ? a : b)) : null
}

// ---------------------------------------------------------------------------
// Instants — rendered per timezone
// ---------------------------------------------------------------------------

export interface DualTimeResult {
  /** Formatted time in zone A (the viewer). */
  a: string
  /** Formatted time in zone B (the partner). */
  b: string
  /** True when both zones are on the same calendar date right now. */
  sameDay: boolean
  /** B's date relative to A's: -1 (yesterday), 0 (same), +1 (tomorrow). */
  dayOffset: number
}

/**
 * Render one instant in two zones at once — the core of the long-distance UI.
 * `utc` is any instant (ISO string or Date).
 */
export function dualTime(
  utc: string | Date,
  tzA: string,
  tzB: string,
  timeFormat = 'HH:mm',
): DualTimeResult {
  const dateA = formatInTimeZone(utc, tzA, ISO_DATE)
  const dateB = formatInTimeZone(utc, tzB, ISO_DATE)
  return {
    a: formatInTimeZone(utc, tzA, timeFormat),
    b: formatInTimeZone(utc, tzB, timeFormat),
    sameDay: dateA === dateB,
    dayOffset: daysBetween(dateA, dateB),
  }
}

/**
 * Resolve a trip-local wall-clock time to a real instant. Only call this when
 * comparing a plan against something that lives in UTC (a flight, "now").
 */
export function tripLocalToUtc(date: DateOnly, time: TimeOnly | null, tripTz: string): Date {
  const normalised = time ? normaliseTime(time) : '00:00:00'
  return fromZonedTime(`${date}T${normalised}`, tripTz)
}

/** Pad a `HH:mm` to `HH:mm:ss` so Postgres `time` values round-trip cleanly. */
export function normaliseTime(time: TimeOnly): string {
  const parts = time.split(':')
  const h = (parts[0] ?? '00').padStart(2, '0')
  const m = (parts[1] ?? '00').padStart(2, '0')
  const s = (parts[2] ?? '00').padStart(2, '0')
  return `${h}:${m}:${s}`
}

/** `14:30:00` → `14:30`. Display helper only. */
export function formatTime(time: TimeOnly | null | undefined): string | null {
  if (!time) return null
  const [h, m] = time.split(':')
  return h && m ? `${h}:${m}` : null
}

export function formatInZone(utc: string | Date, tz: string, pattern: string): string {
  return formatInTimeZone(utc, tz, pattern)
}

/** The viewer's zone, as detected by the browser. Editable in Settings. */
export function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** Current UTC offset of a zone in minutes. For display and sorting only. */
export function offsetMinutes(tz: string, at: Date = new Date()): number {
  const zoned = toZonedTime(at, tz)
  const utc = toZonedTime(at, 'UTC')
  return Math.round((zoned.getTime() - utc.getTime()) / 60000)
}

/**
 * Milliseconds until the next midnight in `tz`. Dashboards schedule a timeout
 * against this so countdowns roll over at the viewer's local midnight.
 */
export function msUntilMidnightIn(tz: string, from: Date = new Date()): number {
  const today = formatInTimeZone(from, tz, ISO_DATE)
  const nextMidnight = fromZonedTime(`${addDaysTo(today, 1)}T00:00:00`, tz)
  return Math.max(0, nextMidnight.getTime() - from.getTime())
}

/** Start of day in the viewer's local zone. Exposed for tests. */
export function localStartOfDay(d: Date = new Date()): Date {
  return startOfDay(d)
}
