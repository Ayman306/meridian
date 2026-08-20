/**
 * A change somebody made, as the feed, the assistant and a webhook all see it.
 *
 * The same shape serves three consumers on purpose. A screen-only type would
 * have grown a second, subtly different one the first time the MCP or a
 * webhook needed the same facts.
 */
export type ActivityEvent =
  | 'trip_created'
  | 'plan_added'
  | 'place_saved'
  | 'verdict_cast'
  | 'stay_booked'
  | 'destination_added'
  | 'flight_added'
  | 'expense_logged'
  | 'photo_added'
  | 'document_added'

export interface Activity {
  event: ActivityEvent
  id: string
  title: string
  subtitle: string | null
  /** Who did it. Null only if the row predates the column. */
  actorId: string | null
  tripId: string | null
  /** ISO instant. A creation is a moment, not a calendar date. */
  at: string
}

/** An outbound webhook. The signing secret is never part of this. */
export interface Integration {
  id: string
  name: string
  url: string
  /** Empty means every event. */
  events: ActivityEvent[]
  enabled: boolean
  lastStatus: number | null
  lastError: string | null
  lastDeliveredAt: string | null
}
