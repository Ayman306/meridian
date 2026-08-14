/**
 * Spherical geometry for the flight map.
 *
 * Spec 9.7 names `@turf/great-circle`. This is forty lines of trigonometry
 * instead, for two reasons: turf's great-circle pulls in two more packages to
 * produce a GeoJSON feature that we would immediately unwrap into coordinate
 * pairs, and the antimeridian split — the part that actually matters — is
 * clearer written out than configured. Every function here is unit-tested,
 * including the Tokyo → Los Angeles case the spec asks for by name.
 *
 * `haversineKm` stays in `lib/utils.ts` where the rest of the app already
 * imports it from.
 */
import type { LatLng } from '@/lib/utils'

const R_KM = 6371.0088
const toRad = (deg: number) => (deg * Math.PI) / 180
const toDeg = (rad: number) => (rad * 180) / Math.PI

/**
 * A point along the great circle between two others, at fraction 0..1.
 *
 * Spherical linear interpolation. The degenerate case — two identical points,
 * where the angular distance is zero and the sines vanish — returns the start
 * rather than dividing by zero.
 */
export function interpolateGreatCircle(from: LatLng, to: LatLng, fraction: number): LatLng {
  const φ1 = toRad(from.lat)
  const λ1 = toRad(from.lng)
  const φ2 = toRad(to.lat)
  const λ2 = toRad(to.lng)

  const δ =
    2 *
    Math.asin(
      Math.min(
        1,
        Math.sqrt(
          Math.sin((φ2 - φ1) / 2) ** 2 +
            Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2,
        ),
      ),
    )

  if (δ === 0) return { lat: from.lat, lng: from.lng }

  const a = Math.sin((1 - fraction) * δ) / Math.sin(δ)
  const b = Math.sin(fraction * δ) / Math.sin(δ)

  const x = a * Math.cos(φ1) * Math.cos(λ1) + b * Math.cos(φ2) * Math.cos(λ2)
  const y = a * Math.cos(φ1) * Math.sin(λ1) + b * Math.cos(φ2) * Math.sin(λ2)
  const z = a * Math.sin(φ1) + b * Math.sin(φ2)

  return {
    lat: toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))),
    lng: toDeg(Math.atan2(y, x)),
  }
}

/**
 * The route as a polyline.
 *
 * Spec 9.7: never a straight line. On a Mercator projection a straight line
 * between London and Tokyo is not the path the aircraft flies, is hundreds of
 * kilometres wrong in the middle, and — more to the point — looks wrong to
 * anyone who has seen a flight map before.
 */
export function greatCirclePoints(from: LatLng, to: LatLng, steps = 100): LatLng[] {
  const points: LatLng[] = []
  for (let i = 0; i <= steps; i++) points.push(interpolateGreatCircle(from, to, i / steps))
  return points
}

/**
 * Split a path where it crosses ±180°.
 *
 * Without this, a Tokyo → Los Angeles route draws a line all the way back
 * across Asia, Europe and the Atlantic — the long way round the world, through
 * every place the flight does not go. Leaflet joins consecutive coordinates by
 * longitude, so the fix is to end one polyline at the dateline and start the
 * next on the other side, with the crossing latitude interpolated so the two
 * segments meet.
 */
export function splitAtAntimeridian(points: readonly LatLng[]): LatLng[][] {
  if (points.length < 2) return points.length ? [[...points]] : []

  const segments: LatLng[][] = []
  let current: LatLng[] = [points[0]!]

  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1]!
    const point = points[i]!
    const delta = point.lng - previous.lng

    // A jump of more than half the globe between adjacent samples is the
    // dateline, not a real movement.
    if (Math.abs(delta) > 180) {
      const goingEast = delta < 0
      const edge = goingEast ? 180 : -180
      const otherEdge = -edge

      // How far along this step the crossing happens.
      const spanToEdge = Math.abs(edge - previous.lng)
      const totalSpan = 360 - Math.abs(delta)
      const t = totalSpan === 0 ? 0.5 : spanToEdge / totalSpan
      const lat = previous.lat + (point.lat - previous.lat) * t

      current.push({ lat, lng: edge })
      segments.push(current)
      current = [{ lat, lng: otherEdge }, point]
      continue
    }

    current.push(point)
  }

  segments.push(current)
  return segments
}

/** Initial bearing from one point to another, in degrees from north. */
export function bearing(from: LatLng, to: LatLng): number {
  const φ1 = toRad(from.lat)
  const φ2 = toRad(to.lat)
  const Δλ = toRad(to.lng - from.lng)

  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

/**
 * Where you end up travelling a distance on a bearing.
 *
 * This is the dead-reckoning step (spec 9.7): between two real fixes, move the
 * marker along its own heading at its own speed rather than letting it
 * teleport. Honest for a minute, dishonest for an hour — which is why the
 * caller stops using it and switches to a hollow marker once the fix is stale.
 */
export function destinationPoint(from: LatLng, bearingDeg: number, distanceKm: number): LatLng {
  const δ = distanceKm / R_KM
  const θ = toRad(bearingDeg)
  const φ1 = toRad(from.lat)
  const λ1 = toRad(from.lng)

  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ))
  const λ2 =
    λ1 +
    Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2))

  return { lat: toDeg(φ2), lng: normaliseLongitude(toDeg(λ2)) }
}

/** Wrap into −180..180 so a point never lands at 190°. */
export function normaliseLongitude(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180
}

/**
 * How far a point lies from the great circle joining two others.
 *
 * Cross-track distance. Used to catch a diversion: an aircraft 300 km off the
 * line between its origin and destination is not on its way there any more
 * (spec 9.5).
 */
export function crossTrackDistanceKm(point: LatLng, from: LatLng, to: LatLng): number {
  const δ13 = angularDistance(from, point)
  const θ13 = toRad(bearing(from, point))
  const θ12 = toRad(bearing(from, to))
  return Math.abs(Math.asin(Math.sin(δ13) * Math.sin(θ13 - θ12)) * R_KM)
}

function angularDistance(a: LatLng, b: LatLng): number {
  const φ1 = toRad(a.lat)
  const φ2 = toRad(b.lat)
  const Δφ = toRad(b.lat - a.lat)
  const Δλ = toRad(b.lng - a.lng)
  const h = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return 2 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Keep a breadcrumb trail renderable: at most one point every `everyMs`. */
export function downsampleByTime<T extends { recorded_at: string }>(
  points: readonly T[],
  everyMs = 120_000,
): T[] {
  const kept: T[] = []
  let lastKeptAt = -Infinity

  for (const point of points) {
    const at = new Date(point.recorded_at).getTime()
    if (at - lastKeptAt >= everyMs) {
      kept.push(point)
      lastKeptAt = at
    }
  }

  // The newest fix always survives — it is the one the marker sits on.
  const newest = points[points.length - 1]
  if (newest && kept[kept.length - 1] !== newest) kept.push(newest)
  return kept
}
