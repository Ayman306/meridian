/**
 * Pull flights out of a pasted confirmation email. Spec 9.8.
 *
 * Regex, client-side, no model. Airline confirmations are wildly inconsistent
 * but they all contain the same four things somewhere, and the parse only has
 * to be good enough to pre-fill a form the user confirms before saving. A
 * wrong guess costs one correction; a missing guess costs the typing they were
 * going to do anyway.
 */
import { isValidDateOnly, toDateOnly } from '@/lib/dates'
import { normaliseFlightNumber } from './logic'
import type { ParsedFlight } from './types'

/** 'AC 42', 'AC42', '6E 1234'. Two or three characters, then one to four digits. */
const FLIGHT_NUMBER = /\b([A-Z]{2}|[A-Z]\d|\d[A-Z])\s?(\d{1,4})\b/g

/**
 * Two-letter English words that a flight-number regex cannot tell from an
 * airline code.
 *
 * "at 21:40" and "in 3 hours" both match the pattern perfectly. A few of these
 * are real IATA codes — AS is Alaska, AM is Aeroméxico — and excluding them
 * costs those airlines a pre-filled field. That is the right trade: the parse
 * feeds a form the user confirms, so a missed flight costs one line of typing
 * and a phantom one costs a puzzled correction.
 */
const NOT_AIRLINES = new Set([
  'AT', 'IN', 'ON', 'TO', 'BY', 'OF', 'IS', 'IT', 'AM', 'PM', 'NO', 'WE', 'DO',
  'GO', 'SO', 'UP', 'AS', 'OR', 'AN', 'BE', 'HE', 'ME', 'MY', 'US', 'IF', 'ALL',
])

/** 'YYZ → LIS', 'YYZ - LIS', 'YYZ to LIS'. Matched against uppercased text. */
const ROUTE = /\b([A-Z]{3})\s*(?:→|->|–|—|-|TO)\s*([A-Z]{3})\b/

/** 'Booking reference: ABC123', 'PNR ABC123', 'Confirmation code ABC123'. */
const BOOKING_REF =
  /\b(?:booking\s*(?:reference|ref|code)|confirmation\s*(?:number|code)|PNR|record\s*locator)\b\s*[:#]?\s*([A-Z0-9]{5,8})\b/i

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

/**
 * Everything the text seems to contain.
 *
 * One entry per distinct flight number, because a return booking lists two and
 * a connection lists two more — all of which the user wants added.
 */
export function parseConfirmation(text: string, today = new Date()): ParsedFlight[] {
  if (!text.trim()) return []

  const upper = text.toUpperCase()
  const route = upper.match(ROUTE)
  const bookingRef = text.match(BOOKING_REF)?.[1]?.toUpperCase() ?? null
  const date = findDate(text, today)

  const seen = new Set<string>()
  const flights: ParsedFlight[] = []

  for (const match of upper.matchAll(FLIGHT_NUMBER)) {
    const prefix = match[1]!
    const number = normaliseFlightNumber(`${prefix}${match[2]}`)

    if (seen.has(number)) continue
    // A four-digit year reads as a flight number to a regex.
    if (looksLikeYear(match[0])) continue
    if (NOT_AIRLINES.has(prefix)) continue
    // '21:40' is a departure time, not flight 21 on airline 40.
    if (upper[(match.index ?? 0) + match[0].length] === ':') continue

    seen.add(number)

    flights.push({
      flightNumber: number,
      date,
      originIata: route?.[1] ?? null,
      destIata: route?.[2] ?? null,
      bookingRef,
    })
  }

  return flights
}

function looksLikeYear(raw: string): boolean {
  const digits = raw.replace(/\D/g, '')
  return digits.length === 4 && Number(digits) >= 1990 && Number(digits) <= 2100
}

/**
 * The first date the text offers, in any of the formats confirmations use.
 *
 * ISO first because it is unambiguous. Named months next, because '12 Nov
 * 2026' cannot be misread. Bare numeric dates like 11/12/2026 are deliberately
 * *not* parsed: that is 11 December to half the world and 12 November to the
 * other half, and picking one silently would put someone at an airport on the
 * wrong day.
 */
export function findDate(text: string, today = new Date()): string | null {
  const iso = text.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1]
  if (iso && isValidDateOnly(iso)) return iso

  // Every candidate, not just the first: '42  YYZ' in a route line matches the
  // day-first shape perfectly, and stopping there would miss the real date
  // three words later.

  // '12 November 2026', '12 Nov 2026', '12 Nov'
  for (const match of text.matchAll(/\b(\d{1,2})\s+([A-Za-z]{3,9})\.?(?:\s+(\d{4}))?\b/g)) {
    const found = buildDate(match[3], match[2]!, match[1]!, today)
    if (found) return found
  }

  // 'November 12, 2026', 'Nov 12 2026'
  for (const match of text.matchAll(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?\b/g)) {
    const found = buildDate(match[3], match[1]!, match[2]!, today)
    if (found) return found
  }

  return null
}

function buildDate(
  yearRaw: string | undefined,
  monthRaw: string,
  dayRaw: string,
  today: Date,
): string | null {
  const month = MONTHS[monthRaw.slice(0, 3).toLowerCase()]
  const day = Number(dayRaw)
  if (!month || !Number.isInteger(day) || day < 1 || day > 31) return null

  // No year given: a confirmation is almost always for a date ahead, so a
  // month already past this year means next year.
  const year = yearRaw
    ? Number(yearRaw)
    : month < today.getUTCMonth() + 1
      ? today.getUTCFullYear() + 1
      : today.getUTCFullYear()

  const date = new Date(Date.UTC(year, month - 1, day))
  // Rejects 31 February, which Date would happily roll into March.
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return toDateOnly(date)
}
