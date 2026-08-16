import { describe, expect, it } from 'vitest'
import { DELAY_THRESHOLD_MINUTES, flightNotification } from '@/lib/flights/notify'
import type { FlightRow } from '@/modules/flights/types'

const flight = (over: Partial<FlightRow> = {}): FlightRow =>
  ({
    id: 'f1',
    couple_id: 'c1',
    flight_number: '6E1468',
    origin_iata: 'DXB',
    dest_iata: 'IXE',
    phase: 'scheduled',
    scheduled_departure: '2026-12-06T07:25:00Z',
    estimated_departure: null,
    ...over,
  }) as FlightRow

describe('announcing a phase change', () => {
  it('says when a flight takes off and when it lands', () => {
    const before = flight({ phase: 'boarding' })
    expect(flightNotification(before, flight({ phase: 'departed' }))?.body).toContain('taken off')
    expect(flightNotification(before, flight({ phase: 'landed' }))?.body).toContain('landed')
  })

  it('says when something has gone wrong', () => {
    const before = flight({ phase: 'enroute' })
    expect(flightNotification(before, flight({ phase: 'diverted' }))?.body).toContain('diverted')
    expect(flightNotification(flight(), flight({ phase: 'cancelled' }))?.body).toContain('cancelled')
  })

  it('names the flight and its route', () => {
    const message = flightNotification(flight({ phase: 'enroute' }), flight({ phase: 'landed' }))
    expect(message?.body).toContain('6E1468')
    expect(message?.body).toContain('DXB → IXE')
  })

  it('stays quiet on the phases nobody needs waking for', () => {
    // Visible in the app, and not something anyone would act on.
    expect(flightNotification(flight({ phase: 'scheduled' }), flight({ phase: 'checkin' }))).toBeNull()
    expect(flightNotification(flight({ phase: 'enroute' }), flight({ phase: 'descending' }))).toBeNull()
  })

  it('says nothing when the phase has not moved', () => {
    expect(flightNotification(flight({ phase: 'enroute' }), flight({ phase: 'enroute' }))).toBeNull()
  })

  it('does not re-announce a phase already reached', () => {
    // The sweep runs repeatedly against a landed flight; only the transition
    // is news.
    expect(flightNotification(flight({ phase: 'landed' }), flight({ phase: 'landed' }))).toBeNull()
  })
})

describe('announcing a change of time', () => {
  const scheduled = '2026-12-06T07:25:00Z'

  it('reports a delay past the threshold', () => {
    const message = flightNotification(
      flight({ scheduled_departure: scheduled }),
      flight({ scheduled_departure: scheduled, estimated_departure: '2026-12-06T08:10:00Z' }),
    )
    expect(message?.body).toContain('45 minutes later')
  })

  it('reports an earlier departure too', () => {
    const message = flightNotification(
      flight({ scheduled_departure: scheduled }),
      flight({ scheduled_departure: scheduled, estimated_departure: '2026-12-06T06:50:00Z' }),
    )
    expect(message?.body).toContain('35 minutes earlier')
  })

  it('ignores jitter below the threshold', () => {
    // Airline estimates move by a couple of minutes constantly. Notifying on
    // that is how somebody learns to switch notifications off.
    const message = flightNotification(
      flight({ scheduled_departure: scheduled }),
      flight({ scheduled_departure: scheduled, estimated_departure: '2026-12-06T07:34:00Z' }),
    )
    expect(message).toBeNull()
  })

  it('treats the threshold itself as worth reporting', () => {
    const later = new Date(
      new Date(scheduled).getTime() + DELAY_THRESHOLD_MINUTES * 60_000,
    ).toISOString()
    expect(
      flightNotification(
        flight({ scheduled_departure: scheduled }),
        flight({ scheduled_departure: scheduled, estimated_departure: later }),
      ),
    ).not.toBeNull()
  })

  it('compares against what we previously believed, not the schedule', () => {
    // Already known to be an hour late; a further two minutes is not news.
    const message = flightNotification(
      flight({ scheduled_departure: scheduled, estimated_departure: '2026-12-06T08:25:00Z' }),
      flight({ scheduled_departure: scheduled, estimated_departure: '2026-12-06T08:27:00Z' }),
    )
    expect(message).toBeNull()
  })

  it('says nothing when there are no times at all', () => {
    expect(
      flightNotification(
        flight({ scheduled_departure: null, estimated_departure: null }),
        flight({ scheduled_departure: null, estimated_departure: null }),
      ),
    ).toBeNull()
  })
})

describe('how notifications collapse', () => {
  it('tags every message with the flight, so updates replace each other', () => {
    // Three slips on one flight should leave one notification showing the
    // current answer, not a history of the slippage.
    const a = flightNotification(flight({ phase: 'boarding' }), flight({ phase: 'departed' }))
    const b = flightNotification(flight({ phase: 'enroute' }), flight({ phase: 'landed' }))
    expect(a?.tag).toBe('flight:f1')
    expect(b?.tag).toBe(a?.tag)
  })

  it('points at somewhere real', () => {
    const message = flightNotification(flight({ phase: 'boarding' }), flight({ phase: 'departed' }))
    expect(message?.url).toBe('/flights')
  })
})
