import { describe, expect, it } from 'vitest'
import { findDate, parseConfirmation } from '@/modules/flights/parse'

const TODAY = new Date('2026-06-01T00:00:00Z')

describe('parseConfirmation', () => {
  it('pulls a flight, a route and a date out of an ordinary confirmation', () => {
    const text = `
      Your trip is confirmed.
      Booking reference: XK7T2P
      AC 42  YYZ → LIS
      Departing 12 November 2026 at 21:40
    `
    const [flight] = parseConfirmation(text, TODAY)
    expect(flight).toEqual({
      flightNumber: 'AC42',
      date: '2026-11-12',
      originIata: 'YYZ',
      destIata: 'LIS',
      bookingRef: 'XK7T2P',
    })
  })

  it('finds every distinct flight in a return booking', () => {
    const text = 'Outbound AC42 on 2026-11-12. Return AC43 on 2026-12-05.'
    const flights = parseConfirmation(text, TODAY)
    expect(flights.map((f) => f.flightNumber)).toEqual(['AC42', 'AC43'])
  })

  it('does not list the same flight twice', () => {
    const text = 'AC42 departs at 21:40. Check in for AC 42 three hours before.'
    expect(parseConfirmation(text, TODAY)).toHaveLength(1)
  })

  it('handles a prefix with a digit in it', () => {
    expect(parseConfirmation('6E 1234 DEL to BOM', TODAY)[0]?.flightNumber).toBe('6E1234')
  })

  it('reads a dash or the word "to" as a route', () => {
    expect(parseConfirmation('BA 123 LHR - JFK', TODAY)[0]?.destIata).toBe('JFK')
    expect(parseConfirmation('BA 123 LHR to JFK', TODAY)[0]?.destIata).toBe('JFK')
  })

  it('finds the booking reference in its various guises', () => {
    expect(parseConfirmation('PNR: ABC123 / LH 400', TODAY)[0]?.bookingRef).toBe('ABC123')
    expect(parseConfirmation('Confirmation code XYZ789 for LH 400', TODAY)[0]?.bookingRef).toBe(
      'XYZ789',
    )
  })

  it('says nothing about empty or flightless text', () => {
    expect(parseConfirmation('', TODAY)).toEqual([])
    expect(parseConfirmation('Thanks for booking with us!', TODAY)).toEqual([])
  })
})

describe('findDate', () => {
  it('prefers an unambiguous ISO date', () => {
    expect(findDate('Departs 2026-11-12 at 21:40', TODAY)).toBe('2026-11-12')
  })

  it('reads a named month, day first or month first', () => {
    expect(findDate('12 November 2026', TODAY)).toBe('2026-11-12')
    expect(findDate('November 12, 2026', TODAY)).toBe('2026-11-12')
    expect(findDate('12 Nov 2026', TODAY)).toBe('2026-11-12')
  })

  it('assumes the coming year when none is given', () => {
    // A confirmation is for a date ahead. In June, "12 Nov" is this year and
    // "12 Mar" is next.
    expect(findDate('12 Nov', TODAY)).toBe('2026-11-12')
    expect(findDate('12 Mar', TODAY)).toBe('2027-03-12')
  })

  it('refuses a bare numeric date rather than guessing the convention', () => {
    // 11/12/2026 is 11 December to half the world and 12 November to the
    // other half. Picking one silently puts someone at an airport on the
    // wrong day.
    expect(findDate('Departs 11/12/2026', TODAY)).toBeNull()
  })

  it('rejects a date that does not exist', () => {
    expect(findDate('31 February 2026', TODAY)).toBeNull()
  })

  it('finds nothing in text without one', () => {
    expect(findDate('See you at the airport', TODAY)).toBeNull()
  })
})
