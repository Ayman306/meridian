/**
 * Turning a row into a sentence.
 *
 * Pure, and the part worth testing: the feed's whole value is that it reads
 * like something a person said. "Ada added Borough Market to the plan" is
 * information; "itinerary_items INSERT" is a log line.
 */
import type { Activity, ActivityEvent } from './types'

/**
 * The verb for each event, written to complete "<name> …".
 *
 * Past tense throughout, because everything in this feed has already happened.
 */
const VERBS: Record<ActivityEvent, string> = {
  trip_created: 'started a trip',
  plan_added: 'added to the plan',
  place_saved: 'saved a place',
  verdict_cast: 'voted on',
  stay_booked: 'booked somewhere to stay',
  destination_added: 'suggested a destination',
  flight_added: 'added a flight',
  expense_logged: 'logged an expense',
  photo_added: 'added a photo',
  document_added: 'added a document',
}

export const EVENT_LABELS: Record<ActivityEvent, string> = {
  trip_created: 'Trip',
  plan_added: 'Plan',
  place_saved: 'Saved place',
  verdict_cast: 'Vote',
  stay_booked: 'Stay',
  destination_added: 'Destination',
  flight_added: 'Flight',
  expense_logged: 'Expense',
  photo_added: 'Photo',
  document_added: 'Document',
}

/** Every event a webhook can subscribe to, in the order the settings UI lists them. */
export const ALL_EVENTS: ActivityEvent[] = [
  'trip_created',
  'destination_added',
  'plan_added',
  'place_saved',
  'verdict_cast',
  'stay_booked',
  'flight_added',
  'expense_logged',
  'photo_added',
  'document_added',
]

/**
 * One line, as a person would say it.
 *
 * The name is passed in rather than looked up: the client already holds both
 * profiles, and a second way to render a person is a second way to get it
 * wrong. "Someone" is the fallback for a row created before `created_by`
 * existed — vague, and better than a blank or an id.
 */
export function describeActivity(activity: Activity, actorName: string | null): string {
  const who = actorName ?? 'Someone'
  return `${who} ${VERBS[activity.event]}`
}

/** Where tapping it goes. Same reasoning as search: a wrong link is worse than none. */
export function hrefForActivity(activity: Activity): string {
  switch (activity.event) {
    case 'trip_created':
      return `/trips/${activity.id}`
    case 'plan_added':
      return activity.tripId ? `/trips/${activity.tripId}/plan` : '/trips'
    case 'place_saved':
    case 'verdict_cast':
      return '/wishlist'
    case 'stay_booked':
    case 'destination_added':
      return activity.tripId ? `/trips/${activity.tripId}/where` : '/trips'
    case 'flight_added':
      return activity.tripId ? `/trips/${activity.tripId}/flights` : '/flights'
    case 'expense_logged':
      return activity.tripId ? `/trips/${activity.tripId}/money` : '/money'
    case 'photo_added':
      return activity.tripId ? `/trips/${activity.tripId}/photos` : '/gallery'
    case 'document_added':
      return `/documents/${activity.id}`
  }
}

/**
 * What the other person did, and what you did, kept apart.
 *
 * The feed's reason to exist is the first list. Your own edits echoed back are
 * noise — you were there. They are still returned by the database, because the
 * same query answers "what has happened lately" for an assistant, where
 * excluding the caller would be wrong.
 */
export function splitByActor(
  activities: readonly Activity[],
  selfId: string | null,
): { theirs: Activity[]; mine: Activity[] } {
  return {
    theirs: activities.filter((a) => a.actorId !== selfId),
    mine: activities.filter((a) => a.actorId === selfId),
  }
}

/**
 * How many of these are new since the marker.
 *
 * Compared as instants rather than by trusting the query's floor, because the
 * feed deliberately fetches a wider window than "unread" — you want to see
 * yesterday too, just not bolded.
 */
export function countUnseen(
  activities: readonly Activity[],
  seenAt: string | null | undefined,
): number {
  if (!seenAt) return activities.length
  return activities.filter((a) => a.at > seenAt).length
}

export function isUnseen(activity: Activity, seenAt: string | null | undefined): boolean {
  return !seenAt || activity.at > seenAt
}

/** Whether an integration wants this event. Empty means all of them. */
export function wantsEvent(subscribed: readonly string[], event: string): boolean {
  return subscribed.length === 0 || subscribed.includes(event)
}
