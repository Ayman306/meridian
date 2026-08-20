/**
 * The feed's whole value is that it reads like something a person said.
 *
 * "Ada saved a place: Borough Market" is information. "wishlist_items INSERT"
 * is a log line. These pin the difference, plus the two rules that decide what
 * anybody actually sees: whose changes count as news, and which of them are new.
 */
import { describe, expect, it } from 'vitest'
import {
  ALL_EVENTS,
  EVENT_LABELS,
  countUnseen,
  describeActivity,
  hrefForActivity,
  isUnseen,
  splitByActor,
  wantsEvent,
} from './logic'
import type { Activity, ActivityEvent } from './types'

const activity = (over: Partial<Activity> = {}): Activity => ({
  event: 'place_saved',
  id: 'a1',
  title: 'Borough Market',
  subtitle: 'London',
  actorId: 'them',
  tripId: null,
  at: '2026-08-20T08:00:00.000Z',
  ...over,
})

describe('how a change is described', () => {
  it('reads as a sentence somebody said', () => {
    expect(describeActivity(activity(), 'Ada')).toBe('Ada saved a place')
    expect(describeActivity(activity({ event: 'stay_booked' }), 'Bo')).toBe(
      'Bo booked somewhere to stay',
    )
  })

  it('says "someone" rather than a blank or an id', () => {
    // Rows created before `created_by` existed have no author. Vague is fine;
    // rendering a UUID at somebody over breakfast is not.
    expect(describeActivity(activity({ actorId: null }), null)).toBe('Someone saved a place')
  })

  it('has a verb and a label for every event there is', () => {
    // Guards the guard: adding an event to the database function without one
    // here would render a blank line in the feed.
    for (const event of ALL_EVENTS) {
      expect(describeActivity(activity({ event }), 'Ada')).not.toMatch(/undefined/)
      expect(EVENT_LABELS[event]).toBeTruthy()
    }
  })
})

describe('where a change links to', () => {
  it('goes to the right tab of the right trip', () => {
    expect(hrefForActivity(activity({ event: 'plan_added', tripId: 't1' }))).toBe('/trips/t1/plan')
    expect(hrefForActivity(activity({ event: 'stay_booked', tripId: 't1' }))).toBe('/trips/t1/where')
    expect(hrefForActivity(activity({ event: 'flight_added', tripId: 't1' }))).toBe(
      '/trips/t1/flights',
    )
  })

  it('falls back to the global list when the change belongs to no trip', () => {
    // A save is never attached to a trip, and `/trips/null/where` is the bug
    // this case exists to prevent.
    expect(hrefForActivity(activity({ event: 'place_saved', tripId: null }))).toBe('/wishlist')
    expect(hrefForActivity(activity({ event: 'expense_logged', tripId: null }))).toBe('/money')
  })

  it('gives every event somewhere to go', () => {
    for (const event of ALL_EVENTS) {
      expect(hrefForActivity(activity({ event, tripId: 't1' }))).toMatch(/^\//)
      expect(hrefForActivity(activity({ event, tripId: null }))).toMatch(/^\//)
    }
  })
})

describe('whose changes are news', () => {
  it('keeps theirs and yours apart', () => {
    // Your own edits echoed back are noise — you were there.
    const { theirs, mine } = splitByActor(
      [activity({ id: '1', actorId: 'them' }), activity({ id: '2', actorId: 'me' })],
      'me',
    )
    expect(theirs.map((a) => a.id)).toEqual(['1'])
    expect(mine.map((a) => a.id)).toEqual(['2'])
  })

  it('treats an unattributed change as not yours', () => {
    // Better to show it and be vague than to hide something that happened.
    const { theirs } = splitByActor([activity({ actorId: null })], 'me')
    expect(theirs).toHaveLength(1)
  })
})

describe('what counts as new', () => {
  const older = activity({ id: 'old', at: '2026-08-19T08:00:00.000Z' })
  const newer = activity({ id: 'new', at: '2026-08-20T08:00:00.000Z' })

  it('counts everything when the feed has never been looked at', () => {
    expect(countUnseen([older, newer], null)).toBe(2)
  })

  it('counts only what happened after the marker', () => {
    expect(countUnseen([older, newer], '2026-08-19T12:00:00.000Z')).toBe(1)
    expect(isUnseen(newer, '2026-08-19T12:00:00.000Z')).toBe(true)
    expect(isUnseen(older, '2026-08-19T12:00:00.000Z')).toBe(false)
  })

  it('counts nothing once the marker is past everything', () => {
    // Marking seen must not empty the list — only unbold it.
    expect(countUnseen([older, newer], '2026-08-21T00:00:00.000Z')).toBe(0)
  })
})

describe('which events a webhook wants', () => {
  it('treats an empty subscription as all of them', () => {
    // What most people want, and it saves a wall of checkboxes on the way in.
    for (const event of ALL_EVENTS) {
      expect(wantsEvent([], event)).toBe(true)
    }
  })

  it('sends only what was asked for', () => {
    const subscribed: ActivityEvent[] = ['stay_booked', 'flight_added']
    expect(wantsEvent(subscribed, 'stay_booked')).toBe(true)
    expect(wantsEvent(subscribed, 'expense_logged')).toBe(false)
  })
})
