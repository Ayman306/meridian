/**
 * Pure functions for Module 5 — Itinerary.
 *
 * The rule that governs this whole module: on a stay longer than five nights,
 * a blank day is the desired state. The UI must never suggest filling one.
 * `emptyDayTreatment` is where that decision is made, once.
 */
import {
  dateRange,
  daysBetween,
  formatTime,
  offsetMinutes,
  parseDateOnly,
  type DateOnly,
} from '@/lib/dates'
import { bySortKey } from '@/lib/fractional'
import { LONG_STAY_NIGHTS } from '@/lib/constants'
import { haversineKm } from '@/lib/utils'
import type { ItineraryItem, ItemWarning, Plan } from './types'

// ---------------------------------------------------------------------------
// The two empty states
// ---------------------------------------------------------------------------

export type EmptyTreatment = 'empty' | 'restful'

/**
 * Which empty state a blank day gets.
 *
 * On a short trip a blank day is a gap — offer a quiet way to fill it. On a
 * long stay it is the point of the trip — offer nothing at all. Spec 5.3 calls
 * this "the single most important behavioural rule in the module".
 */
export function emptyDayTreatment(tripNights: number | null): EmptyTreatment {
  if (tripNights === null) return 'empty'
  return tripNights > LONG_STAY_NIGHTS ? 'restful' : 'empty'
}

// ---------------------------------------------------------------------------
// The work-day overlay
// ---------------------------------------------------------------------------

/** One person's working day, expressed in the trip's own wall clock. */
export interface WorkBand {
  personId: string
  /** `HH:mm` in trip-local time. */
  from: string
  to: string
  /**
   * True when their working day, moved into the trip's timezone, runs past
   * midnight. The band is clipped to the day rather than wrapped, because a
   * bar that restarts at the top of the same day reads as two shifts.
   */
  clipped: boolean
}

/**
 * Where somebody's working day falls on a trip day.
 *
 * The whole reason this is not a string comparison: work hours are wall-clock
 * in the *person's own* timezone and the itinerary is wall-clock in the
 * *trip's*. Someone working 09:00–17:00 in Toronto is unavailable 14:00–22:00
 * on a Lisbon trip, and drawing 09:00–17:00 on the Lisbon day would tell their
 * partner the afternoon was free when it is the one part that is not.
 *
 * Returns null when either end is unset — a half-known working day is not
 * something to draw. Offsets are read for the specific date so a band that
 * straddles a daylight-saving change lands where it actually is.
 */
export function workBand(
  person: { id: string; timezone: string; work_hours_start: string | null; work_hours_end: string | null },
  date: DateOnly,
  tripTimezone: string,
): WorkBand | null {
  if (!person.work_hours_start || !person.work_hours_end) return null

  const shift = offsetMinutes(tripTimezone, parseDateOnly(date)) -
    offsetMinutes(person.timezone, parseDateOnly(date))

  const from = minutesOf(person.work_hours_start) + shift
  const to = minutesOf(person.work_hours_end) + shift

  // Clipped, not wrapped. A working day that starts on the trip's previous
  // evening shows as running from midnight; one ending after it shows as
  // running to midnight. Either way it is one continuous band.
  const clipped = from < 0 || to > 24 * 60

  return {
    personId: person.id,
    from: clockOf(Math.max(0, Math.min(24 * 60, from))),
    to: clockOf(Math.max(0, Math.min(24 * 60, to))),
    clipped,
  }
}

/** Whether a planned time lands inside somebody's working day. */
export function clashesWithWork(time: string | null, band: WorkBand | null): boolean {
  if (!time || !band) return false
  const at = time.slice(0, 5)
  return at >= band.from && at < band.to
}

function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

function clockOf(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

/**
 * Within a day: timed items first in chronological order, then untimed ones in
 * manual order.
 *
 * The spec notes the alternative (untimed first) is defensible; what matters is
 * picking one and never mixing. We put timed first because a day with a 09:00
 * flight and a loose "buy stamps" reads as a schedule with slack, not a pile.
 */
export function sortDayItems(items: readonly ItineraryItem[]): ItineraryItem[] {
  const timed = items.filter((i) => i.start_time !== null)
  const untimed = items.filter((i) => i.start_time === null)

  timed.sort((a, b) => {
    const t = (a.start_time ?? '').localeCompare(b.start_time ?? '')
    return t !== 0 ? t : bySortKey(a, b)
  })
  untimed.sort(bySortKey)

  return [...timed, ...untimed]
}

/**
 * Split a trip's items into the shape the plan view reads: the pool, the days,
 * and anything stranded outside the trip's range by a later date change.
 */
export function buildPlan(
  items: readonly ItineraryItem[],
  tripStart: DateOnly | null,
  tripEnd: DateOnly | null,
): Plan {
  const pool: ItineraryItem[] = []
  const orphaned: ItineraryItem[] = []
  const byDate: Record<DateOnly, ItineraryItem[]> = {}

  for (const item of items) {
    if (item.deleted_at) continue

    if (!item.scheduled_date) {
      pool.push(item)
      continue
    }
    if (isOutsideTrip(item.scheduled_date, tripStart, tripEnd)) {
      orphaned.push(item)
      continue
    }
    ;(byDate[item.scheduled_date] ??= []).push(item)
  }

  pool.sort(bySortKey)
  orphaned.sort((a, b) => (a.scheduled_date ?? '').localeCompare(b.scheduled_date ?? ''))
  for (const date of Object.keys(byDate)) {
    byDate[date] = sortDayItems(byDate[date]!)
  }

  return { pool, byDate, orphaned }
}

function isOutsideTrip(
  date: DateOnly,
  start: DateOnly | null,
  end: DateOnly | null,
): boolean {
  // A trip with no dates has no "outside" — everything is legitimately loose.
  if (!start) return false
  if (date < start) return true
  return end !== null && date > end
}

/** Every day the plan view should render, in order. Empty when dates are unset. */
export function planDays(tripStart: DateOnly | null, tripEnd: DateOnly | null): DateOnly[] {
  if (!tripStart) return []
  return dateRange(tripStart, tripEnd ?? tripStart)
}

// ---------------------------------------------------------------------------
// Conflict detection — warn, never block
// ---------------------------------------------------------------------------

/** Assumed door-to-door speed for the tight-connection check, km/h. */
const ASSUMED_SPEED_KMH = 25
/** Straight-line distance underestimates real routes; scale it. */
const ROUTE_FACTOR = 1.4
/** Above this many items, a day on a long stay gets a gentle note. */
const BUSY_DAY_ITEMS = 4

/**
 * Everything questionable about one day's plan. All of it is advisory — the
 * user may genuinely intend a tight connection, and the app does not know
 * about the taxi they booked.
 */
export function dayWarnings(
  items: readonly ItineraryItem[],
  opts: { isLongStay?: boolean } = {},
): ItemWarning[] {
  const warnings: ItemWarning[] = []
  const timed = items.filter((i) => i.start_time)

  for (let i = 0; i < timed.length - 1; i++) {
    const a = timed[i]!
    const b = timed[i + 1]!

    if (overlaps(a, b)) {
      warnings.push({
        kind: 'overlap',
        itemId: b.id,
        message: `Overlaps “${a.title}”`,
      })
      continue
    }

    const travel = travelMinutes(a, b)
    if (travel !== null) {
      const gap = gapMinutes(a, b)
      if (gap !== null && gap < travel) {
        warnings.push({
          kind: 'tight',
          itemId: b.id,
          message: `Tight — about ${Math.round(travel)} min to get here, ${gap} min of gap`,
        })
      }
    }
  }

  if (opts.isLongStay && items.length > BUSY_DAY_ITEMS) {
    warnings.push({
      kind: 'busy',
      itemId: items[0]!.id,
      message: `${items.length} things today`,
    })
  }

  return warnings
}

/** End of an item in minutes past midnight, from end_time or a duration. */
function endMinutes(item: ItineraryItem): number | null {
  const start = toMinutes(item.start_time)
  if (start === null) return null

  if (item.end_time) {
    const end = toMinutes(item.end_time)
    // An end before the start means it crosses midnight (spec 5.6).
    if (end !== null) return end < start ? end + 1440 : end
  }
  if (item.duration_minutes) return start + item.duration_minutes
  return start
}

function overlaps(a: ItineraryItem, b: ItineraryItem): boolean {
  const aEnd = endMinutes(a)
  const bStart = toMinutes(b.start_time)
  if (aEnd === null || bStart === null) return false
  return bStart < aEnd
}

function gapMinutes(a: ItineraryItem, b: ItineraryItem): number | null {
  const aEnd = endMinutes(a)
  const bStart = toMinutes(b.start_time)
  if (aEnd === null || bStart === null) return null
  return bStart - aEnd
}

/** Rough door-to-door minutes between two placed items. Null if unplaceable. */
function travelMinutes(a: ItineraryItem, b: ItineraryItem): number | null {
  if (a.lat === null || a.lng === null || b.lat === null || b.lng === null) return null
  const km =
    haversineKm({ lat: Number(a.lat), lng: Number(a.lng) }, { lat: Number(b.lat), lng: Number(b.lng) }) *
    ROUTE_FACTOR
  if (km < 0.3) return null // same place, effectively
  return (km / ASSUMED_SPEED_KMH) * 60
}

export function toMinutes(time: string | null): number | null {
  if (!time) return null
  const [h, m] = time.split(':')
  if (h === undefined || m === undefined) return null
  return Number(h) * 60 + Number(m)
}

/** "14:00" / "14:00 – 16:30" / "" for an untimed item. */
export function formatItemTime(item: Pick<ItineraryItem, 'start_time' | 'end_time'>): string {
  const start = formatTime(item.start_time)
  if (!start) return ''
  const end = formatTime(item.end_time)
  return end ? `${start} – ${end}` : start
}

// ---------------------------------------------------------------------------
// Pacing heuristics — used by the blend generator (Module 7), tested here
// ---------------------------------------------------------------------------

/** An item long enough to be the day's centrepiece. */
const ANCHOR_MINUTES = 180

export interface PacingReport {
  ok: boolean
  problems: string[]
}

/**
 * Whether a proposed day respects the pacing rules the spec lays out. Nothing
 * enforces this — it exists so the generator can avoid producing days a person
 * would not actually enjoy.
 */
export function checkPacing(
  items: readonly Pick<ItineraryItem, 'category_id' | 'duration_minutes'>[],
): PacingReport {
  const problems: string[] = []

  let run = 1
  for (let i = 1; i < items.length; i++) {
    const same = items[i]!.category_id !== null && items[i]!.category_id === items[i - 1]!.category_id
    run = same ? run + 1 : 1
    if (run >= 3) {
      problems.push('Three of the same kind in a row')
      break
    }
  }

  const anchors = items.filter((i) => (i.duration_minutes ?? 0) > ANCHOR_MINUTES).length
  if (anchors > 1) problems.push('More than one long anchor in a day')

  return { ok: problems.length === 0, problems }
}

/** How full a day is, for the calendar cell's dot. */
export function dayDensity(count: number): 'none' | 'light' | 'medium' | 'full' {
  if (count === 0) return 'none'
  if (count <= 2) return 'light'
  if (count <= 4) return 'medium'
  return 'full'
}

/** Days in a trip that carry items — asked before shortening the trip. */
export function daysWithItems(items: readonly ItineraryItem[]): Map<DateOnly, number> {
  const counts = new Map<DateOnly, number>()
  for (const item of items) {
    if (item.deleted_at || !item.scheduled_date) continue
    counts.set(item.scheduled_date, (counts.get(item.scheduled_date) ?? 0) + 1)
  }
  return counts
}

/** Where a scheduled item sits relative to the trip: which day number. */
export function dayNumber(date: DateOnly, tripStart: DateOnly | null): number | null {
  if (!tripStart) return null
  const n = daysBetween(tripStart, date)
  return n >= 0 ? n + 1 : null
}
