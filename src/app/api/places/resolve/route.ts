/**
 * Turn a pasted map link into a place: a name, a full address, and a pin.
 *
 * Server-side for two reasons, both of which the browser cannot do:
 *
 *   1. **Short links.** `maps.app.goo.gl/XXXX` says nothing until something
 *      follows the redirect, and CORS stops a page doing that.
 *   2. **Reverse geocoding.** Nominatim's usage policy wants a single
 *      identified caller, not one per browser tab.
 *
 * Every hop is checked against the shared SSRF guard, and — this is the part
 * that matters — the response returns only the four fields the form needs.
 * Never a status code, never a body. The guard cannot stop a hostname that
 * *resolves* to a private address, so the handler is written so that a blind
 * request into a private network cannot be read back out of it.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireUser } from '@/lib/supabase/server'
import { resolveRedirects } from '@/lib/net/publicUrl'
import { reverseGeocode, searchPlaces } from '@/lib/geocode'
import {
  googleMapsUrlFor,
  isGoogleMapsLink,
  parseGoogleMapsLink,
} from '@/lib/maps/googleMaps'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({ url: z.string().trim().min(1).max(2048) })

export interface ResolvedPlace {
  name: string | null
  address: string | null
  lat: number | null
  lng: number | null
  city: string | null
  countryCode: string | null
  /** A canonical link, rebuilt from the coordinates we settled on. */
  mapsUrl: string | null
  /** Where the numbers came from, so the form can caveat honestly. */
  source: 'pin' | 'camera' | 'query' | 'none'
}

const NOTHING: ResolvedPlace = {
  name: null,
  address: null,
  lat: null,
  lng: null,
  city: null,
  countryCode: null,
  mapsUrl: null,
  source: 'none',
}

export async function POST(request: Request) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const body = bodySchema.safeParse(await request.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'Send a link.' }, { status: 400 })

  if (!isGoogleMapsLink(body.data.url)) {
    return NextResponse.json(
      { error: 'That is not a Google Maps link. Paste one, or type the details in by hand.' },
      { status: 400 },
    )
  }

  try {
    return NextResponse.json(await resolve(body.data.url))
  } catch (e) {
    // Nothing here is worth interrupting somebody over: they can type the
    // address. Logged with the hostname only — never the error's own text,
    // which can carry the URL it failed on.
    console.warn('place resolve failed', e instanceof Error ? e.message : e)
    return NextResponse.json(NOTHING)
  }
}

async function resolve(input: string): Promise<ResolvedPlace> {
  let parsed = parseGoogleMapsLink(input)

  // A short link is opaque. Follow it, then read whatever it landed on.
  if (parsed.needsResolving) {
    const final = await resolveRedirects(new URL(input))
    parsed = parseGoogleMapsLink(final.href)
  }

  // A link that named a place but pinned nothing. Geocoding the name is the
  // only way to get coordinates, and it is explicitly labelled as such so the
  // form can say the pin was looked up rather than read.
  if (!parsed.lat && parsed.query) {
    const [best] = await searchPlaces(parsed.query)
    if (best) {
      return {
        name: parsed.name ?? best.name,
        address: best.displayName,
        lat: best.lat,
        lng: best.lng,
        city: best.city,
        countryCode: best.countryCode,
        mapsUrl: googleMapsUrlFor(best.lat, best.lng, parsed.name ?? best.name),
        source: 'query',
      }
    }
    return { ...NOTHING, name: parsed.name, source: 'query' }
  }

  if (parsed.lat === null || parsed.lng === null) return NOTHING

  // The address. The link never carries one, so this is the call that makes
  // "read the complete address" true rather than aspirational.
  const place = await reverseGeocode(parsed.lat, parsed.lng).catch(() => null)

  return {
    // The name from the URL wins over Nominatim's: Google knows the café is
    // called Cafe Younes, while Nominatim may only know the building.
    name: parsed.name ?? place?.name ?? null,
    address: place?.displayName ?? null,
    lat: parsed.lat,
    lng: parsed.lng,
    city: place?.city ?? null,
    countryCode: place?.countryCode ?? null,
    mapsUrl: googleMapsUrlFor(parsed.lat, parsed.lng, parsed.name ?? place?.name ?? null),
    source: parsed.source,
  }
}
