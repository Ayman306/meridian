/** Pure functions for Module 3 — Trips. No Supabase, no React. */
import {
  addDaysTo,
  dateRange,
  daysBetween,
  nightsBetween,
  parseDateOnly,
  type DateOnly,
} from '@/lib/dates'
import { LONG_STAY_NIGHTS } from '@/lib/constants'
import type { DatePrecision, Trip, TripTraveler, TripGroup, TogetherWindow } from './types'

// ---------------------------------------------------------------------------
// Duration
// ---------------------------------------------------------------------------

/**
 * Nights, always derived and never stored. Null when we can't know.
 *
 * 12th–16th is 4 nights across 5 days. Users think in nights for accommodation
 * and days for planning, so screens generally show both.
 */
export function nights(trip: Pick<Trip, 'start_date' | 'end_date'>): number | null {
  if (!trip.start_date || !trip.end_date) return null
  return nightsBetween(trip.start_date, trip.end_date)
}

export function days(trip: Pick<Trip, 'start_date' | 'end_date'>): number | null {
  const n = nights(trip)
  return n === null ? null : n + 1
}

/**
 * Long-stay mode changes the whole planning surface: month grid instead of a
 * day list, and blank days become restful rather than empty.
 *
 * The spec is explicit that this activates at 6 nights, not 5.
 */
export function isLongStay(trip: Pick<Trip, 'start_date' | 'end_date'>): boolean {
  const n = nights(trip)
  return n !== null && n > LONG_STAY_NIGHTS
}

// ---------------------------------------------------------------------------
// Date precision — affects display, never storage
// ---------------------------------------------------------------------------

const SEASONS: Record<number, string> = {
  0: 'Winter', 1: 'Winter', 2: 'Spring', 3: 'Spring', 4: 'Spring', 5: 'Summer',
  6: 'Summer', 7: 'Summer', 8: 'Autumn', 9: 'Autumn', 10: 'Autumn', 11: 'Winter',
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** "Nov 12, 2026" / "November 2026" / "Spring 2026" / "2026" / "Dates TBD". */
export function formatTripDates(trip: Pick<Trip, 'start_date' | 'end_date' | 'date_precision' | 'is_open_ended'>): string {
  const { start_date, end_date, date_precision, is_open_ended } = trip
  if (!start_date) return 'Dates TBD'

  const d = parseDateOnly(start_date)
  const year = d.getFullYear()
  const month = MONTHS[d.getMonth()] ?? ''

  switch (date_precision) {
    case 'year':
      return String(year)
    case 'season':
      return `${SEASONS[d.getMonth()] ?? ''} ${year}`
    case 'month':
      return `${month} ${year}`
    case 'exact':
    case 'unknown':
    default: {
      const startLabel = formatDay(start_date)
      if (is_open_ended) return `${startLabel} onwards`
      if (!end_date) return startLabel
      return sameYear(start_date, end_date)
        ? `${formatDay(start_date, false)} – ${formatDay(end_date)}`
        : `${startLabel} – ${formatDay(end_date)}`
    }
  }
}

function formatDay(date: DateOnly, withYear = true): string {
  const d = parseDateOnly(date)
  const month = MONTHS[d.getMonth()]?.slice(0, 3) ?? ''
  return withYear ? `${month} ${d.getDate()}, ${d.getFullYear()}` : `${month} ${d.getDate()}`
}

function sameYear(a: DateOnly, b: DateOnly): boolean {
  return a.slice(0, 4) === b.slice(0, 4)
}

/**
 * Countdowns render only for exact dates. Never show "247 days" for a trip
 * that is pinned to nothing more precise than a season.
 *
 * `today` is the viewer's own calendar date — the year boundary and "is it
 * today yet" both depend on whose timezone is asking, so the caller resolves it.
 */
export function countdownDays(
  trip: Pick<Trip, 'start_date' | 'date_precision'>,
  today: DateOnly,
): number | null {
  if (trip.date_precision !== 'exact' || !trip.start_date) return null
  const delta = daysBetween(today, trip.start_date)
  return delta >= 0 ? delta : null
}

/**
 * Vague precisions still need a stored date to sort by. Snap to the start of
 * the period the user actually meant.
 */
export function snapStartToPrecision(date: DateOnly, precision: DatePrecision): DateOnly {
  const d = parseDateOnly(date)
  switch (precision) {
    case 'year':
      return `${d.getFullYear()}-01-01`
    case 'season': {
      // Seasons start in Dec / Mar / Jun / Sep.
      const seasonStart = [12, 12, 3, 3, 3, 6, 6, 6, 9, 9, 9, 12][d.getMonth()] ?? 1
      const year = d.getMonth() === 11 ? d.getFullYear() : seasonStart === 12 ? d.getFullYear() - 1 : d.getFullYear()
      return `${year}-${String(seasonStart).padStart(2, '0')}-01`
    }
    case 'month':
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
    default:
      return date
  }
}

// ---------------------------------------------------------------------------
// The together window
// ---------------------------------------------------------------------------

/**
 * When both of them are actually in the same place. Falls back to the trip's
 * own dates for any traveler who hasn't set their own.
 *
 * A negative overlap is surfaced as a warning rather than clamped away: it is
 * almost always a data-entry error worth pointing at.
 */
export function togetherWindow(
  trip: Pick<Trip, 'start_date' | 'end_date'>,
  travelers: readonly Pick<TripTraveler, 'user_id' | 'arrival_date' | 'departure_date'>[],
): TogetherWindow {
  if (travelers.length < 2) {
    return { start: null, end: null, nights: 0, overlaps: false, incomplete: true }
  }

  const arrivals: DateOnly[] = []
  const departures: DateOnly[] = []
  for (const t of travelers) {
    const arrival = t.arrival_date ?? trip.start_date
    const departure = t.departure_date ?? trip.end_date
    if (!arrival || !departure) {
      return { start: null, end: null, nights: 0, overlaps: false, incomplete: true }
    }
    arrivals.push(arrival)
    departures.push(departure)
  }

  const start = arrivals.reduce((a, b) => (a > b ? a : b))
  const end = departures.reduce((a, b) => (a < b ? a : b))
  const overlap = daysBetween(start, end)

  return {
    start,
    end,
    nights: Math.max(0, overlap),
    overlaps: overlap >= 0,
    incomplete: false,
  }
}

// ---------------------------------------------------------------------------
// Grouping and sorting the trip list
// ---------------------------------------------------------------------------

/**
 * Active → Upcoming → Planning (no dates) → Past.
 *
 * Sort within group: upcoming by start ascending, planning by most recently
 * touched, past by start descending — in each case, what you'd reach for first.
 */
export function groupTrips<T extends Trip>(
  trips: readonly T[],
  today: DateOnly,
): Record<TripGroup, T[]> {
  const groups: Record<TripGroup, T[]> = { active: [], upcoming: [], planning: [], past: [] }

  for (const trip of trips) {
    groups[tripGroup(trip, today)].push(trip)
  }

  groups.active.sort((a, b) => (a.start_date ?? '').localeCompare(b.start_date ?? ''))
  groups.upcoming.sort((a, b) => (a.start_date ?? '').localeCompare(b.start_date ?? ''))
  groups.planning.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  groups.past.sort((a, b) => (b.start_date ?? '').localeCompare(a.start_date ?? ''))

  return groups
}

export function tripGroup(
  trip: Pick<Trip, 'start_date' | 'end_date' | 'is_open_ended'>,
  today: DateOnly,
): TripGroup {
  if (!trip.start_date) return 'planning'

  const end = trip.is_open_ended
    ? addDaysTo(trip.start_date, 3650) // open-ended trips never fall into the past
    : (trip.end_date ?? trip.start_date)

  if (trip.start_date <= today && today <= end) return 'active'
  if (trip.start_date > today) return 'upcoming'
  return 'past'
}

export const GROUP_LABELS: Record<TripGroup, string> = {
  active: 'Now',
  upcoming: 'Coming up',
  planning: 'Still deciding',
  past: 'Been',
}

// ---------------------------------------------------------------------------
// Day scaffolding
// ---------------------------------------------------------------------------

export interface DayDiff {
  toAdd: DateOnly[]
  toRemove: DateOnly[]
}

/**
 * What changing a trip's dates would do to its day grid.
 *
 * The caller shows `toRemove` to the user before committing when any of those
 * days carry itinerary items — the spec is emphatic that shortening a trip must
 * prompt, never silently delete.
 */
export function diffTripDays(
  existing: readonly DateOnly[],
  start: DateOnly | null,
  end: DateOnly | null,
  isOpenEnded = false,
): DayDiff {
  if (!start) return { toAdd: [], toRemove: [...existing] }

  const horizon = isOpenEnded || !end ? addDaysTo(start, 30) : end
  const wanted = dateRange(start, horizon)
  const have = new Set(existing)
  const want = new Set(wanted)

  return {
    toAdd: wanted.filter((d) => !have.has(d)),
    toRemove: existing.filter((d) => !want.has(d)),
  }
}

/**
 * Day type auto-assignment (spec 5.3). A manually set type is never demoted —
 * someone who marked a day "rest" meant it, even if an item lands on it later.
 */
export function nextDayType(
  current: string,
  opts: { hasFlight?: boolean; itemCount?: number },
): string {
  if (opts.hasFlight) return 'travel'
  if (current === 'open' && (opts.itemCount ?? 0) > 0) return 'planned'
  return current
}

/** Trips that overlap in time. Allowed — a short stay can nest in a long one. */
export function overlappingTrips<T extends Trip>(trip: Trip, others: readonly T[]): T[] {
  if (!trip.start_date) return []
  const aStart = trip.start_date
  const aEnd = trip.end_date ?? trip.start_date

  return others.filter((o) => {
    if (o.id === trip.id || !o.start_date) return false
    const bEnd = o.end_date ?? o.start_date
    return aStart <= bEnd && o.start_date <= aEnd
  })
}

/** A trip whose dates have passed but is still marked as being planned. */
export function isStalePlanning(
  trip: Pick<Trip, 'start_date' | 'end_date'>,
  today: DateOnly,
  statusName?: string,
): boolean {
  if (!statusName || !['Idea', 'Planning', 'Booked'].includes(statusName)) return false
  const end = trip.end_date ?? trip.start_date
  return Boolean(end && end < today)
}
