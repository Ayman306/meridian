/**
 * Reading a pasted Google Maps link.
 *
 * Pure and heavily tested, because Google emits at least six different URL
 * shapes for "this place" and the differences are not cosmetic — several of
 * them carry *two* coordinate pairs that mean different things.
 *
 * The one that catches everybody: in a `/maps/place/…` URL, the `@lat,lng,17z`
 * segment is **where the camera was**, not where the place is. Pan the map
 * before copying the link and that number is a street away, or a suburb away.
 * The actual pin lives in the opaque `data=` payload as `!3d<lat>!4d<lng>`. So
 * when both are present the `!3d!4d` pair wins, and a test pins that.
 *
 * Shapes handled:
 *
 *   /maps/place/Name/@12.9,74.8,17z/data=…!3d12.87!4d74.84   → pin from !3d!4d
 *   /maps/place/Name/@12.9,74.8,17z                          → camera, as a fallback
 *   /maps/search/?api=1&query=12.9,74.8                      → coordinates
 *   /maps/search/?api=1&query=Cafe+Younes                    → a name to search
 *   /maps?q=12.9,74.8  ·  ?ll=  ·  ?daddr=  ·  /maps/@lat,lng,z
 *   maps.app.goo.gl/XXXX  ·  goo.gl/maps/XXXX                → needs resolving first
 *
 * Nothing here does I/O. Short links are *recognised*, not followed — that
 * needs a server, and it lives in `/api/places/resolve`.
 */

/** What a link turned out to contain. */
export interface ParsedMapsLink {
  /** Coordinates, when the link carried them. */
  lat: number | null
  lng: number | null
  /** The place name lifted from the URL, tidied. Often all a short link gives. */
  name: string | null
  /** A free-text query, when the link names a place instead of pinning one. */
  query: string | null
  /**
   * True when this is a shortened link whose target is unknown until something
   * follows the redirect. Everything else on the object will be null.
   */
  needsResolving: boolean
  /** Where the numbers came from, so the caller can say how sure it is. */
  source: 'pin' | 'camera' | 'query' | 'none'
}

const EMPTY: ParsedMapsLink = {
  lat: null,
  lng: null,
  name: null,
  query: null,
  needsResolving: false,
  source: 'none',
}

/** Hosts whose links are shortened and must be followed before they say anything. */
const SHORT_HOSTS = ['maps.app.goo.gl', 'goo.gl', 'g.co']

/** Hosts we will read at all. */
const MAPS_HOSTS = [
  'google.com',
  'www.google.com',
  'maps.google.com',
  'maps.app.goo.gl',
  'goo.gl',
  'g.co',
]

/** Whether a string looks like something this module can do anything with. */
export function isGoogleMapsLink(value: string): boolean {
  const url = safeUrl(value)
  if (!url) return false
  const host = url.hostname.toLowerCase()
  return (
    MAPS_HOSTS.includes(host) ||
    // google.co.uk, google.co.in and the rest of the country domains.
    /(^|\.)google\.[a-z.]{2,6}$/.test(host)
  )
}

function safeUrl(value: string): URL | null {
  try {
    return new URL(value.trim())
  } catch {
    return null
  }
}

/**
 * Latitude and longitude are checked, not just parsed.
 *
 * `parseFloat` is happy to return a number from almost anything, and a
 * longitude of 700 written into the database is a pin somewhere off the map
 * that nobody can explain later.
 */
function coords(latRaw: string | undefined, lngRaw: string | undefined) {
  if (!latRaw || !lngRaw) return null
  const lat = Number(latRaw)
  const lng = Number(lngRaw)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  // 0,0 is in the Atlantic and is what a broken parse produces far more often
  // than a genuine pin. Refusing it loses nothing anybody wanted to save.
  if (lat === 0 && lng === 0) return null
  return { lat, lng }
}

/** `Cafe+Younes` and `Cafe%20Younes` are both the same café. */
function tidyName(raw: string | null | undefined): string | null {
  if (!raw) return null
  let text = raw
  try {
    text = decodeURIComponent(raw)
  } catch {
    // A malformed escape sequence. Use it as it came rather than throwing away
    // a perfectly readable name for one bad character.
  }
  text = text.replace(/\+/g, ' ').trim()
  // Google appends its own coordinate segment to some place paths.
  if (/^@?-?\d+\.\d+,-?\d+\.\d+/.test(text)) return null
  return text.length > 0 ? text.slice(0, 200) : null
}

/**
 * Read whatever a Google Maps URL is willing to tell us.
 *
 * Never throws. A link it cannot read comes back as `source: 'none'` with
 * everything null, because the caller's job in that case is to let the person
 * type the details by hand — not to show them an error about a link that was
 * probably fine.
 */
export function parseGoogleMapsLink(value: string): ParsedMapsLink {
  const url = safeUrl(value)
  if (!url || !isGoogleMapsLink(value)) return EMPTY

  const host = url.hostname.toLowerCase()
  if (SHORT_HOSTS.includes(host)) {
    // Nothing in a short link is readable. Even the path is an opaque id.
    return { ...EMPTY, needsResolving: true }
  }

  const path = decodeSafe(url.pathname)
  const params = url.searchParams

  // 1. The pin itself, hidden in the data payload. Highest priority: this is
  //    the place, whereas @lat,lng is only where the camera was pointing.
  const pin = /!3d(-?\d+\.?\d*)!4d(-?\d+\.?\d*)/.exec(url.href)
  const pinned = pin ? coords(pin[1], pin[2]) : null

  // 2. The name, from /maps/place/<Name>/…
  const placeMatch = /\/maps\/place\/([^/@]+)/.exec(path)
  const name = tidyName(placeMatch?.[1])

  if (pinned) {
    return { ...pinned, name, query: null, needsResolving: false, source: 'pin' }
  }

  // 3. Explicit coordinate parameters. `query` and `q` may hold either a
  //    coordinate pair or a search phrase, so each is tried as numbers first.
  for (const key of ['query', 'q', 'll', 'daddr', 'center']) {
    const raw = params.get(key)
    if (!raw) continue
    // The trailing `(Label)` is Google's own documented form for naming a
    // coordinate pair — and it is what `googleMapsUrlFor` below emits, so a
    // parser that rejected it could not read back the links this app saves.
    // Losing that means a saved place silently loses its pin when re-opened.
    const pair = /^\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*(?:\(([^)]*)\))?\s*$/.exec(raw)
    const parsed = pair ? coords(pair[1], pair[2]) : null
    if (parsed) {
      return {
        ...parsed,
        name: name ?? tidyName(pair?.[3]),
        query: null,
        needsResolving: false,
        source: 'pin',
      }
    }
  }

  // 4. The camera position. Used only when nothing better was found, and
  //    labelled `camera` so the caller can say it is approximate.
  const camera = /@(-?\d+\.?\d*),(-?\d+\.?\d*)/.exec(url.href)
  const viewed = camera ? coords(camera[1], camera[2]) : null
  if (viewed) {
    return { ...viewed, name, query: null, needsResolving: false, source: 'camera' }
  }

  // 5. No coordinates at all — but a name or a search phrase is still enough
  //    to geocode from, which is better than nothing.
  const searchMatch = /\/maps\/search\/([^/?]+)/.exec(path)
  const query = name ?? tidyName(params.get('query')) ?? tidyName(params.get('q')) ?? tidyName(searchMatch?.[1])

  if (query) {
    return { lat: null, lng: null, name: name ?? query, query, needsResolving: false, source: 'query' }
  }

  return EMPTY
}

function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * A link back to Google Maps for coordinates we hold.
 *
 * Built rather than stored, so a pin corrected in the app does not keep opening
 * the old place. `?q=lat,lng` is the form that works on every platform,
 * including opening the native app on a phone.
 */
export function googleMapsUrlFor(lat: number, lng: number, label?: string | null): string {
  const query = label ? `${lat},${lng}(${encodeURIComponent(label)})` : `${lat},${lng}`
  return `https://www.google.com/maps/search/?api=1&query=${query}`
}

/** How sure the caller may sound about what came back. */
export function describeParseSource(parsed: ParsedMapsLink): string | null {
  switch (parsed.source) {
    case 'pin':
      return null // Exact. Nothing to caveat.
    case 'camera':
      return 'That link did not carry the pin itself, only where the map was centred — check the marker is on the right spot.'
    case 'query':
      return 'That link named a place but held no coordinates, so this was looked up by name.'
    case 'none':
      return null
  }
}
