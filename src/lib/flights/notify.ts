/**
 * Deciding whether a change to a flight is worth interrupting somebody for.
 *
 * Pure, so the judgement can be tested without a push service. The sweep calls
 * this with the row before and after a refresh and sends whatever comes back.
 *
 * The bar is deliberately high. This app's whole reason for existing is that
 * two people are in different places, so a notification here often arrives at
 * four in the morning for one of them. Only transitions that change what
 * somebody would *do* qualify: they are in the air, they are on the ground,
 * something went wrong, or the time moved enough to matter for a lift to the
 * airport.
 *
 * Everything else — a position update, `enroute` becoming `descending`, a
 * two-minute drift — is visible in the app and is not worth a buzz.
 */
import type { FlightRow, Phase } from '@/modules/flights/types'
import type { PushMessage } from '@/lib/push/server'

/**
 * How far a time has to move before it is news.
 *
 * Fifteen minutes is the point where a plan changes: below it nobody leaves
 * for the airport differently, and airline estimates jitter by a few minutes
 * constantly. A lower threshold would turn one delayed flight into a dozen
 * notifications, which is how people learn to switch them off.
 */
export const DELAY_THRESHOLD_MINUTES = 15

/** Phases that are worth announcing the moment they are first reached. */
const ANNOUNCED: Partial<Record<Phase, (flight: FlightRow) => string>> = {
  departed: (f) => `${label(f)} has taken off.`,
  landed: (f) => `${label(f)} has landed${f.dest_iata ? ` in ${f.dest_iata}` : ''}.`,
  diverted: (f) => `${label(f)} has diverted.`,
  cancelled: (f) => `${label(f)} has been cancelled.`,
}

function label(flight: FlightRow): string {
  const route =
    flight.origin_iata && flight.dest_iata ? ` (${flight.origin_iata} → ${flight.dest_iata})` : ''
  return `${flight.flight_number}${route}`
}

function minutesBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60_000)
}

/**
 * What to send, if anything.
 *
 * `tag` is the flight id throughout, so a second notification about the same
 * flight replaces the first rather than stacking — a delayed flight that slips
 * three times should leave one notification showing the current answer, not a
 * history of the slippage.
 */
export function flightNotification(before: FlightRow, after: FlightRow): PushMessage | null {
  const url = `/flights`
  const tag = `flight:${after.id}`

  // A phase reached for the first time. Compared rather than just read, so a
  // sweep that finds nothing changed says nothing.
  if (after.phase !== before.phase) {
    const describe = ANNOUNCED[after.phase as Phase]
    if (describe) {
      return { title: 'Meridian', body: describe(after), url, tag }
    }
  }

  // A material change to when it leaves. The comparison is against whatever we
  // previously believed — an estimate if we had one, otherwise the schedule —
  // because that is what the person is currently planning around.
  const wasExpected = before.estimated_departure ?? before.scheduled_departure
  const nowExpected = after.estimated_departure ?? after.scheduled_departure

  if (wasExpected && nowExpected) {
    const drift = minutesBetween(wasExpected, nowExpected)
    if (Math.abs(drift) >= DELAY_THRESHOLD_MINUTES) {
      const direction = drift > 0 ? 'later' : 'earlier'
      return {
        title: 'Meridian',
        body: `${label(after)} is now leaving ${Math.abs(drift)} minutes ${direction}.`,
        url,
        tag,
      }
    }
  }

  return null
}
