/**
 * Reverse geocoding, against stubbed Nominatim responses.
 *
 * Stubbed rather than live on purpose. Nominatim asks not to be hammered — the
 * throttle in `geocode.ts` exists for that reason — and a test suite that
 * called a free public service on every run would be exactly the abuse the
 * policy is about. The response shapes here are copied from real answers,
 * including the one that matters most: a miss comes back as **HTTP 200 with an
 * `error` field**, not a 404.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { reverseGeocode } from '@/lib/geocode'

afterEach(() => vi.unstubAllGlobals())

const ok = (body: unknown) =>
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body } as Response),
  )

const hit = {
  name: 'Cafe Younes',
  display_name: 'Cafe Younes, Balmatta Road, Mangaluru, Dakshina Kannada, Karnataka, 575001, India',
  lat: '12.8698',
  lon: '74.8430',
  type: 'cafe',
  category: 'amenity',
  address: { city: 'Mangaluru', country_code: 'in' },
}

describe('coordinates to an address', () => {
  it('returns the full display name, which is the whole point', () => {
    // A Google Maps link carries a pin and at best a place name. The address
    // is the thing this call exists to add.
    ok(hit)
    return expect(reverseGeocode(12.8698, 74.843)).resolves.toMatchObject({
      name: 'Cafe Younes',
      displayName: hit.display_name,
      city: 'Mangaluru',
      countryCode: 'IN',
      lat: 12.8698,
      lng: 74.843,
    })
  })

  it('asks for building-level detail', async () => {
    const spy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => hit } as Response)
    vi.stubGlobal('fetch', spy)
    await reverseGeocode(12.8698, 74.843)

    const url = new URL((spy.mock.calls[0] as [URL])[0].toString())
    // Lower than 18 and Nominatim answers with a suburb, which is not an
    // address.
    expect(url.searchParams.get('zoom')).toBe('18')
    expect(url.searchParams.get('addressdetails')).toBe('1')
    expect(url.pathname).toContain('/reverse')
  })

  it('treats a 200-with-error as nothing found, not as a result', () => {
    // The trap: Nominatim answers a miss with 200 and an `error` field. Reading
    // that as a hit would save a place whose address is the string "Unable to
    // geocode".
    ok({ error: 'Unable to geocode' })
    return expect(reverseGeocode(0.5, 0.5)).resolves.toBeNull()
  })

  it('treats a response with no display name as nothing found', () => {
    ok({ lat: '1', lon: '1' })
    return expect(reverseGeocode(1, 1)).resolves.toBeNull()
  })

  it('falls back to the first line when there is no name', () => {
    ok({ ...hit, name: '' })
    return expect(reverseGeocode(12.8698, 74.843)).resolves.toMatchObject({
      name: 'Cafe Younes',
    })
  })
})

describe('refusing to call out at all', () => {
  it('does not spend a request on coordinates that cannot exist', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)

    expect(await reverseGeocode(91, 0)).toBeNull()
    expect(await reverseGeocode(0, 181)).toBeNull()
    expect(await reverseGeocode(Number.NaN, 0)).toBeNull()
    // The throttle is a shared budget; wasting it on input we already know is
    // invalid slows down the calls that were fine.
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('when Nominatim is unhappy', () => {
  it('reports rate limiting as retryable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 } as Response))
    await expect(reverseGeocode(12.8698, 74.843)).rejects.toMatchObject({
      kind: 'rate_limit',
      retryable: true,
    })
  })

  it('reports an outage as upstream', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 } as Response))
    await expect(reverseGeocode(12.8698, 74.843)).rejects.toMatchObject({ kind: 'upstream' })
  })
})
