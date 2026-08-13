/**
 * Pure functions for Module 2 — Dashboard.
 *
 * Everything here takes the viewer's calendar date rather than reading the
 * clock. That is not tidiness: "which year is this night in?" and "is today
 * travel day?" have different answers for the two people looking, and spec 2.6
 * settles it — use the viewer's timezone. Passing `today` in makes whose
 * midnight is being used visible at every call site.
 */
import { daysBetween, maxDate, minDate, type DateOnly } from '@/lib/dates'
import type {
  Alert,
  Countdown,
  DashboardPayload,
  DashboardTraveller,
  ExpiringDocumentRow,
  NightsTogether,
  StaleTripRow,
  TogetherWindowRow,
} from './types'

// ---------------------------------------------------------------------------
// The countdown state machine (spec 2.3)
// ---------------------------------------------------------------------------

/**
 * Countdowns render only for exact dates. A trip pinned to "Spring 2026" gets
 * its label, never a number — "247 days" implies a precision that isn't there.
 */
export function countdown(payload: DashboardPayload, today: DateOnly): Countdown {
  const trip = payload.next_trip ?? null
  const travellers = payload.travellers ?? []

  if (!trip) {
    if (payload.planning_trip) {
      return {
        state: 'PLANNING',
        tripId: payload.planning_trip.id,
        title: payload.planning_trip.title,
        days: null,
        dayOfTotal: null,
        dateLabel: 'Dates TBD',
      }
    }
    return { state: 'EMPTY', tripId: null, title: null, days: null, dayOfTotal: null, dateLabel: null }
  }

  const base = { tripId: trip.id, title: trip.title }
  const start = trip.start_date
  if (!start) {
    return { ...base, state: 'PLANNING', days: null, dayOfTotal: null, dateLabel: 'Dates TBD' }
  }

  const end = trip.is_open_ended ? null : (trip.end_date ?? start)

  // A vague trip's stored date is an artifact of snapping — "2026" lives as
  // 2026-01-01. Treating that as a real start would declare the couple
  // "together" from January for a trip nobody has booked, so anything less
  // precise than exact stays in COUNTDOWN with its label and never enters the
  // travel-day / together / departing states.
  if (trip.date_precision !== 'exact') {
    return {
      ...base,
      state: 'COUNTDOWN',
      days: null,
      dayOfTotal: null,
      dateLabel: describePrecision(trip.date_precision, start),
    }
  }

  // Someone flying today outranks everything — it is the only fact that
  // matters on the day.
  if (travellers.some((t) => t.arrival_date === today || (t.arrival_date ?? start) === today)) {
    return { ...base, state: 'TRAVEL_DAY', days: 0, dayOfTotal: null, dateLabel: null }
  }
  if (travellers.some((t) => (t.departure_date ?? end) === today)) {
    return { ...base, state: 'DEPARTING', days: 0, dayOfTotal: null, dateLabel: null }
  }

  const window = togetherWindow(start, end, travellers)
  if (window.start && window.end && window.start <= today && today <= window.end) {
    const day = daysBetween(window.start, today) + 1
    const total = daysBetween(window.start, window.end) + 1
    return { ...base, state: 'TOGETHER', days: null, dayOfTotal: { day, total }, dateLabel: null }
  }

  if (start > today) {
    return {
      ...base,
      state: 'COUNTDOWN',
      days: daysBetween(today, start),
      dayOfTotal: null,
      dateLabel: null,
    }
  }

  // Started, nobody's dates say otherwise — treat as together.
  return { ...base, state: 'TOGETHER', days: null, dayOfTotal: null, dateLabel: null }
}

const SEASONS = ['Winter', 'Winter', 'Spring', 'Spring', 'Spring', 'Summer',
                 'Summer', 'Summer', 'Autumn', 'Autumn', 'Autumn', 'Winter']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December']

function describePrecision(precision: string, start: DateOnly): string {
  const year = start.slice(0, 4)
  const monthIndex = Number(start.slice(5, 7)) - 1
  switch (precision) {
    case 'year':
      return year
    case 'season':
      return `${SEASONS[monthIndex] ?? ''} ${year}`
    case 'month':
      return `${MONTHS[monthIndex] ?? ''} ${year}`
    default:
      return 'Dates TBD'
  }
}

// ---------------------------------------------------------------------------
// Nights together (spec 2.3)
// ---------------------------------------------------------------------------

/**
 * The intersection of the two travellers' presence, per trip.
 * Falls back to the trip's own dates for anyone who set none.
 */
export function togetherWindow(
  tripStart: DateOnly | null,
  tripEnd: DateOnly | null,
  travellers: readonly DashboardTraveller[],
): { start: DateOnly | null; end: DateOnly | null } {
  if (travellers.length < 2) return { start: tripStart, end: tripEnd }

  const arrivals = travellers.map((t) => t.arrival_date ?? tripStart)
  const departures = travellers.map((t) => t.departure_date ?? tripEnd)

  return { start: maxDate(...arrivals), end: minDate(...departures) }
}

/**
 * Nights actually spent in the same place: this calendar year, and ever.
 *
 * Only counts nights that have already happened — a trip you are on right now
 * contributes the nights up to today, not the ones still ahead. Counting
 * future nights would make the number go down if the trip were cut short,
 * which is a strange thing for a "nights together" counter to do.
 */
export function nightsTogether(
  windows: readonly TogetherWindowRow[],
  today: DateOnly,
): NightsTogether {
  const yearPrefix = today.slice(0, 4)
  let thisYear = 0
  let lifetime = 0

  for (const row of windows) {
    const { start, end } = togetherWindow(row.start_date, row.end_date, row.travellers)
    if (!start || !end) continue

    // Nothing beyond today has been lived yet.
    const cappedEnd = end < today ? end : today
    if (cappedEnd < start) continue

    const nights = Math.max(0, daysBetween(start, cappedEnd))
    lifetime += nights
    thisYear += nightsWithinYear(start, cappedEnd, yearPrefix)
  }

  return { thisYear, lifetime }
}

/**
 * Nights from a window that fall inside one calendar year. A trip spanning new
 * year contributes to both, split at the boundary — not counted twice.
 */
function nightsWithinYear(start: DateOnly, end: DateOnly, year: string): number {
  const yearStart = `${year}-01-01`
  const yearEnd = `${year}-12-31`

  const from = start > yearStart ? start : yearStart
  const to = end < yearEnd ? end : yearEnd
  if (to < from) return 0

  return Math.max(0, daysBetween(from, to))
}

// ---------------------------------------------------------------------------
// Alerts (spec 2.2 — highest priority first)
// ---------------------------------------------------------------------------

const PRIORITY = {
  document_expiring: 1,
  passport_validity: 2,
  stay_allowance: 3,
  flight_delay: 4,
  stale_trip: 5,
} as const

/** At most this many before the rest go behind "see all" (spec 2.7). */
export const VISIBLE_ALERTS = 3

export function buildAlerts(payload: DashboardPayload, today: DateOnly): Alert[] {
  const alerts: Alert[] = []

  for (const doc of payload.expiring_documents ?? []) {
    alerts.push(doc.is_passport ? passportAlert(doc, today) : documentAlert(doc, today))
  }

  for (const trip of payload.stale_trips ?? []) {
    alerts.push(staleTripAlert(trip))
  }

  // Stay-allowance and flight-delay alerts slot in at priorities 3 and 4 when
  // those modules land (phases 9 and 10).

  return sortAlerts(alerts)
}

function documentAlert(doc: ExpiringDocumentRow, today: DateOnly): Alert {
  const days = daysBetween(today, doc.expires_on)
  const expired = days < 0
  return {
    kind: 'document_expiring',
    priority: PRIORITY.document_expiring,
    severity: expired || days < 30 ? 'blocking' : 'warning',
    title: expired ? `${doc.label} has expired` : `${doc.label} expires soon`,
    detail: expired ? doc.expires_on : `${days} days — ${doc.expires_on}`,
    href: `/documents/${doc.id}`,
    ownerId: doc.owner_id,
  }
}

function passportAlert(doc: ExpiringDocumentRow, today: DateOnly): Alert {
  const days = daysBetween(today, doc.expires_on)
  // Six months of validity beyond entry is what most countries want, so a
  // passport becomes a problem long before it expires. Say why.
  const blocking = days < 183
  return {
    kind: 'passport_validity',
    priority: PRIORITY.passport_validity,
    severity: blocking ? 'blocking' : 'warning',
    title: blocking ? 'Passport under 6 months validity' : 'Passport expires within a year',
    detail: blocking
      ? `Expires ${doc.expires_on} — many countries refuse entry inside 6 months`
      : `Expires ${doc.expires_on} — renew before the 6-month rule bites`,
    href: `/documents/${doc.id}`,
    ownerId: doc.owner_id,
  }
}

function staleTripAlert(trip: StaleTripRow): Alert {
  return {
    kind: 'stale_trip',
    priority: PRIORITY.stale_trip,
    severity: 'warning',
    title: `“${trip.title}” still has no dates`,
    detail: 'Untouched for a couple of months',
    href: `/trips/${trip.id}`,
    ownerId: null,
  }
}

/** Priority first, then blocking before warning within a priority. */
export function sortAlerts(alerts: readonly Alert[]): Alert[] {
  return [...alerts].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority
    if (a.severity !== b.severity) return a.severity === 'blocking' ? -1 : 1
    return a.title.localeCompare(b.title)
  })
}

// ---------------------------------------------------------------------------
// Clocks
// ---------------------------------------------------------------------------

/**
 * Whether it is light where someone is, without an API call or a library.
 *
 * A crude sunrise/sunset model: good to roughly half an hour at temperate
 * latitudes, which is all a day/night dot needs. `suncalc` is a dependency we
 * do not need for a dot.
 */
export function isDaylight(date: Date, lat: number | null, lng: number | null): boolean | null {
  if (lat === null || lng === null) return null

  const dayOfYear = Math.floor(
    (date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86_400_000,
  )
  const declination = 23.44 * Math.sin(((2 * Math.PI) / 365) * (dayOfYear - 81))
  const latRad = (lat * Math.PI) / 180
  const decRad = (declination * Math.PI) / 180

  const cosHourAngle = -Math.tan(latRad) * Math.tan(decRad)
  // Polar day and polar night: the sun never sets, or never rises.
  if (cosHourAngle <= -1) return true
  if (cosHourAngle >= 1) return false

  const halfDayHours = (Math.acos(cosHourAngle) * 180) / Math.PI / 15
  const solarNoon = 12 - lng / 15
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60

  return utcHours > solarNoon - halfDayHours && utcHours < solarNoon + halfDayHours
}
