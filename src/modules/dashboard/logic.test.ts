import { describe, expect, it } from 'vitest'
import {
  buildAlerts,
  countdown,
  isDaylight,
  nightsTogether,
  sortAlerts,
  togetherWindow,
} from '@/modules/dashboard/logic'
import type { Alert, DashboardPayload, TogetherWindowRow } from '@/modules/dashboard/types'

const TODAY = '2026-06-15'

const payload = (over: Partial<DashboardPayload> = {}): DashboardPayload => ({
  paired: true,
  couple_id: 'c1',
  next_trip: null,
  planning_trip: null,
  travellers: [],
  together_windows: [],
  expiring_documents: [],
  stale_trips: [],
  trip_count: 0,
  ...over,
})

const trip = (over: Partial<NonNullable<DashboardPayload['next_trip']>> = {}) => ({
  id: 't1',
  title: 'Lisbon',
  start_date: '2026-08-01',
  end_date: '2026-08-10',
  date_precision: 'exact',
  is_open_ended: false,
  timezone: 'Europe/Lisbon',
  status_name: 'Booked',
  ...over,
})

describe('the countdown state machine', () => {
  it('invites you to start when there is nothing at all', () => {
    expect(countdown(payload(), TODAY).state).toBe('EMPTY')
  })

  it('names a dateless trip rather than counting to nothing', () => {
    const c = countdown(
      payload({ planning_trip: { id: 'p1', title: 'Somewhere warm', updated_at: '' } }),
      TODAY,
    )
    expect(c.state).toBe('PLANNING')
    expect(c.title).toBe('Somewhere warm')
    expect(c.days).toBeNull()
  })

  it('counts down to an exact date', () => {
    const c = countdown(payload({ next_trip: trip() }), TODAY)
    expect(c.state).toBe('COUNTDOWN')
    expect(c.days).toBe(47)
  })

  it('refuses to count down to a vague one', () => {
    // "247 days" implies a precision that isn't there.
    const c = countdown(
      payload({ next_trip: trip({ date_precision: 'season', start_date: '2026-09-01' }) }),
      TODAY,
    )
    expect(c.state).toBe('COUNTDOWN')
    expect(c.days).toBeNull()
    expect(c.dateLabel).toBe('Autumn 2026')
  })

  it('labels month and year precision too', () => {
    expect(
      countdown(
        payload({ next_trip: trip({ date_precision: 'month', start_date: '2026-11-01' }) }),
        TODAY,
      ).dateLabel,
    ).toBe('November 2026')
    expect(
      countdown(
        payload({ next_trip: trip({ date_precision: 'year', start_date: '2026-01-01' }) }),
        TODAY,
      ).dateLabel,
    ).toBe('2026')
  })

  it('never calls a vague trip "together", however old its snapped date is', () => {
    // "2026" is stored as 2026-01-01. Once that date passed, an earlier version
    // of this declared the couple together for a trip nobody had booked.
    const c = countdown(
      payload({
        next_trip: trip({ date_precision: 'year', start_date: '2026-01-01', end_date: null }),
        travellers: [
          { user_id: 'a', arrival_date: null, departure_date: null },
          { user_id: 'b', arrival_date: null, departure_date: null },
        ],
      }),
      TODAY,
    )
    expect(c.state).toBe('COUNTDOWN')
    expect(c.dateLabel).toBe('2026')
    expect(c.days).toBeNull()
  })

  it('makes travel day outrank everything', () => {
    const c = countdown(
      payload({
        next_trip: trip({ start_date: TODAY, end_date: '2026-06-25' }),
        travellers: [
          { user_id: 'a', arrival_date: TODAY, departure_date: '2026-06-25' },
          { user_id: 'b', arrival_date: '2026-06-16', departure_date: '2026-06-25' },
        ],
      }),
      TODAY,
    )
    expect(c.state).toBe('TRAVEL_DAY')
  })

  it('counts the day of the stay once both have arrived', () => {
    const c = countdown(
      payload({
        next_trip: trip({ start_date: '2026-06-10', end_date: '2026-06-20' }),
        travellers: [
          { user_id: 'a', arrival_date: '2026-06-10', departure_date: '2026-06-20' },
          { user_id: 'b', arrival_date: '2026-06-12', departure_date: '2026-06-18' },
        ],
      }),
      TODAY,
    )
    expect(c.state).toBe('TOGETHER')
    // Together from the 12th to the 18th; the 15th is day 4 of 7.
    expect(c.dayOfTotal).toEqual({ day: 4, total: 7 })
  })

  it('knows the last day', () => {
    const c = countdown(
      payload({
        next_trip: trip({ start_date: '2026-06-10', end_date: '2026-06-20' }),
        travellers: [
          { user_id: 'a', arrival_date: '2026-06-10', departure_date: TODAY },
          { user_id: 'b', arrival_date: '2026-06-10', departure_date: '2026-06-20' },
        ],
      }),
      TODAY,
    )
    expect(c.state).toBe('DEPARTING')
  })
})

describe('nights together', () => {
  const window = (over: Partial<TogetherWindowRow> = {}): TogetherWindowRow => ({
    trip_id: 't1',
    start_date: '2026-03-01',
    end_date: '2026-03-11',
    travellers: [
      { user_id: 'a', arrival_date: '2026-03-01', departure_date: '2026-03-11' },
      { user_id: 'b', arrival_date: '2026-03-03', departure_date: '2026-03-09' },
    ],
    ...over,
  })

  it('counts the overlap, not the trip', () => {
    // Both present from the 3rd to the 9th: six nights, not ten.
    const n = nightsTogether([window()], TODAY)
    expect(n.thisYear).toBe(6)
    expect(n.lifetime).toBe(6)
  })

  it('counts only nights already lived', () => {
    // A trip running through today contributes up to today, not to its end —
    // otherwise the number would shrink if the trip were cut short.
    const n = nightsTogether(
      [
        window({
          start_date: '2026-06-10',
          end_date: '2026-06-30',
          travellers: [
            { user_id: 'a', arrival_date: '2026-06-10', departure_date: '2026-06-30' },
            { user_id: 'b', arrival_date: '2026-06-10', departure_date: '2026-06-30' },
          ],
        }),
      ],
      TODAY,
    )
    expect(n.lifetime).toBe(5)
  })

  it('splits a trip that crosses new year rather than double-counting', () => {
    const n = nightsTogether(
      [
        window({
          start_date: '2025-12-28',
          end_date: '2026-01-04',
          travellers: [
            { user_id: 'a', arrival_date: '2025-12-28', departure_date: '2026-01-04' },
            { user_id: 'b', arrival_date: '2025-12-28', departure_date: '2026-01-04' },
          ],
        }),
      ],
      TODAY,
    )
    expect(n.lifetime).toBe(7)
    // Only the nights falling in 2026 count towards this year.
    expect(n.thisYear).toBe(3)
  })

  it('ignores a trip where they never overlapped', () => {
    const n = nightsTogether(
      [
        window({
          travellers: [
            { user_id: 'a', arrival_date: '2026-03-01', departure_date: '2026-03-04' },
            { user_id: 'b', arrival_date: '2026-03-08', departure_date: '2026-03-11' },
          ],
        }),
      ],
      TODAY,
    )
    expect(n.lifetime).toBe(0)
  })

  it('falls back to the trip dates when a traveller set none', () => {
    const w = togetherWindow('2026-03-01', '2026-03-10', [
      { user_id: 'a', arrival_date: null, departure_date: null },
      { user_id: 'b', arrival_date: '2026-03-04', departure_date: null },
    ])
    expect(w.start).toBe('2026-03-04')
    expect(w.end).toBe('2026-03-10')
  })
})

describe('alerts', () => {
  it('explains a passport, rather than just flagging it', () => {
    const alerts = buildAlerts(
      payload({
        expiring_documents: [
          {
            id: 'd1',
            label: 'Passport',
            owner_id: 'u1',
            type_name: 'Passport',
            expires_on: '2026-09-01',
            is_passport: true,
          },
        ],
      }),
      TODAY,
    )
    expect(alerts[0]?.kind).toBe('passport_validity')
    expect(alerts[0]?.severity).toBe('blocking')
    expect(alerts[0]?.detail).toMatch(/refuse entry/i)
  })

  it('puts documents above stale trips, whatever order they arrive in', () => {
    const alerts = buildAlerts(
      payload({
        stale_trips: [{ id: 't9', title: 'Someday', updated_at: '2026-01-01T00:00:00Z' }],
        expiring_documents: [
          {
            id: 'd1',
            label: 'Insurance',
            owner_id: 'u1',
            type_name: 'Travel Insurance',
            expires_on: '2026-07-01',
            is_passport: false,
          },
        ],
      }),
      TODAY,
    )
    expect(alerts.map((a) => a.kind)).toEqual(['document_expiring', 'stale_trip'])
  })

  it('sorts blocking above warning within the same priority', () => {
    const base = { kind: 'document_expiring', priority: 1, href: null, ownerId: null } as const
    const sorted = sortAlerts([
      { ...base, severity: 'warning', title: 'B', detail: null } as Alert,
      { ...base, severity: 'blocking', title: 'A', detail: null } as Alert,
    ])
    expect(sorted[0]?.severity).toBe('blocking')
  })

  it('says nothing when there is nothing to say', () => {
    expect(buildAlerts(payload(), TODAY)).toEqual([])
  })
})

describe('daylight', () => {
  it('is day at noon and night at midnight', () => {
    // London in June: 12:00 UTC is midday, 00:00 UTC is the middle of the night.
    expect(isDaylight(new Date('2026-06-15T12:00:00Z'), 51.5, -0.13)).toBe(true)
    expect(isDaylight(new Date('2026-06-15T00:00:00Z'), 51.5, -0.13)).toBe(false)
  })

  it('handles the polar summer, where the sun never sets', () => {
    expect(isDaylight(new Date('2026-06-15T23:00:00Z'), 78, 15)).toBe(true)
  })

  it('handles the polar winter', () => {
    expect(isDaylight(new Date('2026-12-15T12:00:00Z'), 78, 15)).toBe(false)
  })

  it('says nothing rather than guessing without coordinates', () => {
    expect(isDaylight(new Date(), null, null)).toBeNull()
  })
})
