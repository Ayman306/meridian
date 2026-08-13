/**
 * City search via Nominatim. Free, no key, and rate-limited to one request per
 * second by their usage policy — we serialise requests through a queue rather
 * than hoping the user types slowly.
 *
 * Timezone is resolved from coordinates offline (no API call) by the caller.
 */
import { GEOCODE_MIN_INTERVAL_MS, NOMINATIM_BASE } from '@/lib/constants'
import { AppError } from '@/lib/errors'

export interface CityResult {
  name: string
  displayName: string
  countryCode: string | null
  country: string | null
  lat: number
  lng: number
}

let lastCall = 0
let chain: Promise<unknown> = Promise.resolve()

/** Serialise calls and space them at least GEOCODE_MIN_INTERVAL_MS apart. */
function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = Math.max(0, lastCall + GEOCODE_MIN_INTERVAL_MS - Date.now())
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    lastCall = Date.now()
    return fn()
  })
  chain = run.catch(() => undefined)
  return run
}

interface NominatimPlace {
  display_name: string
  lat: string
  lon: string
  name?: string
  type?: string
  category?: string
  address?: {
    country?: string
    country_code?: string
    city?: string
    town?: string
    village?: string
  }
}

export async function searchCity(query: string, signal?: AbortSignal): Promise<CityResult[]> {
  const q = query.trim()
  if (q.length < 2) return []

  return throttled(async () => {
    const url = new URL(`${NOMINATIM_BASE}/search`)
    url.searchParams.set('q', q)
    url.searchParams.set('format', 'jsonv2')
    url.searchParams.set('addressdetails', '1')
    url.searchParams.set('limit', '6')
    url.searchParams.set('featuretype', 'city')

    const res = await fetch(url, {
      signal: signal ?? null,
      headers: { Accept: 'application/json', 'Accept-Language': 'en' },
    })
    if (!res.ok) {
      throw new AppError('City search is unavailable right now.', {
        kind: res.status === 429 ? 'rate_limit' : 'upstream',
        retryable: true,
      })
    }
    const places = (await res.json()) as NominatimPlace[]
    return places.map(toCityResult)
  })
}

/**
 * Any place, not just cities — a restaurant, a viewpoint, a street.
 *
 * Separate from `searchCity` because the two want different results for the
 * same string: "Porto" as a destination is the city, "Porto" while adding a
 * wishlist save might be the wine cellar. Same throttle, same policy.
 */
export async function searchPlaces(query: string, signal?: AbortSignal): Promise<PlaceResult[]> {
  const q = query.trim()
  if (q.length < 2) return []

  return throttled(async () => {
    const url = new URL(`${NOMINATIM_BASE}/search`)
    url.searchParams.set('q', q)
    url.searchParams.set('format', 'jsonv2')
    url.searchParams.set('addressdetails', '1')
    url.searchParams.set('limit', '8')

    const res = await fetch(url, {
      signal: signal ?? null,
      headers: { Accept: 'application/json', 'Accept-Language': 'en' },
    })
    if (!res.ok) {
      throw new AppError('Place search is unavailable right now.', {
        kind: res.status === 429 ? 'rate_limit' : 'upstream',
        retryable: true,
      })
    }

    const places = (await res.json()) as NominatimPlace[]
    return places.map((p) => {
      const parts = p.display_name.split(',').map((s) => s.trim())
      return {
        name: p.name || parts[0] || p.display_name,
        displayName: p.display_name,
        city: p.address?.city ?? p.address?.town ?? p.address?.village ?? null,
        countryCode: p.address?.country_code?.toUpperCase() ?? null,
        kind: p.type ?? p.category ?? null,
        lat: Number(p.lat),
        lng: Number(p.lon),
      }
    })
  })
}

export interface PlaceResult {
  name: string
  displayName: string
  city: string | null
  countryCode: string | null
  kind: string | null
  lat: number
  lng: number
}

function toCityResult(p: NominatimPlace): CityResult {
  const parts = p.display_name.split(',').map((s) => s.trim())
  return {
    name: p.name || parts[0] || p.display_name,
    displayName: p.display_name,
    country: p.address?.country ?? parts[parts.length - 1] ?? null,
    countryCode: p.address?.country_code?.toUpperCase() ?? null,
    lat: Number(p.lat),
    lng: Number(p.lon),
  }
}

/**
 * Best-effort IANA zone for a coordinate without a network call.
 *
 * The `tz-lookup` package (added in the Destinations module, which needs
 * precision) does this properly from a shapefile. Until then we only need the
 * zone the browser already reports for the user's own machine, so profile setup
 * defaults to that and offers this as a coarse fallback for remote coordinates.
 */
export function coarseTimezoneFromLongitude(lng: number): string {
  const hours = Math.round(lng / 15)
  if (hours === 0) return 'UTC'
  // Etc/GMT zones are sign-inverted: Etc/GMT-5 is UTC+5.
  return `Etc/GMT${hours > 0 ? '-' : '+'}${Math.abs(hours)}`
}
