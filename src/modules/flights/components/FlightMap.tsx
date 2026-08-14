/**
 * The live flight map. Spec 9.7.
 *
 * Same imperative Leaflet approach as Module 6 and no new dependency. Two
 * rules from the spec are load-bearing here and both are visible in the code:
 *
 *   The route is a great circle, split at the antimeridian. A straight line on
 *   Mercator is geometrically wrong, and a Tokyo → Los Angeles route drawn
 *   naively goes the long way round the world.
 *
 *   An estimated position is never drawn like a real one. Hollow outline,
 *   dashed stroke, labelled. This is "the single most important rule in the
 *   map layer" — the difference between informing someone and lying to them
 *   while they drive to an airport.
 */
'use client'

import 'leaflet/dist/leaflet.css'

import { useEffect, useRef } from 'react'
import type * as Leaflet from 'leaflet'
import type { LatLng } from '@/lib/utils'
import { destinationPoint, downsampleByTime, greatCirclePoints, splitAtAntimeridian } from '@/lib/geo'
import { MAX_ZOOM, MIN_ZOOM } from '@/modules/map'
import { estimatedPosition } from '../logic'
import type { FlightPosition, FlightState } from '../types'

export interface FlightMapProps {
  state: FlightState
  /** Breadcrumb trail, oldest first. */
  track: FlightPosition[]
  /** The waiting partner's home — makes the closing gap literal. */
  watcherHome: LatLng | null
  followAircraft: boolean
  reducedMotion: boolean
  className?: string
}

export function FlightMap({
  state,
  track,
  watcherHome,
  followAircraft,
  reducedMotion,
  className,
}: FlightMapProps) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<Leaflet.Map | null>(null)
  const leaflet = useRef<typeof Leaflet | null>(null)
  const layers = useRef<Leaflet.Layer[]>([])
  const aircraft = useRef<Leaflet.Marker | null>(null)
  const animation = useRef<number | null>(null)
  const props = useRef({ state, track, watcherHome, followAircraft, reducedMotion })

  useEffect(() => {
    props.current = { state, track, watcherHome, followAircraft, reducedMotion }
  })

  useEffect(() => {
    let cancelled = false

    void (async () => {
      const L = (await import('leaflet')).default
      if (cancelled || !container.current || map.current) return

      leaflet.current = L
      const created = L.map(container.current, {
        center: [20, 0],
        zoom: 3,
        minZoom: MIN_ZOOM,
        maxZoom: MAX_ZOOM,
        worldCopyJump: true,
      })

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: MAX_ZOOM,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(created)

      map.current = created
      setTimeout(() => created.invalidateSize(), 0)
    })()

    return () => {
      cancelled = true
      if (animation.current) cancelAnimationFrame(animation.current)
      map.current?.remove()
      map.current = null
      aircraft.current = null
      layers.current = []
    }
  }, [])

  // Route, trail, airports, aircraft. Rebuilt whenever the state changes,
  // which at 60s intervals is cheap enough not to bother diffing.
  useEffect(() => {
    const L = leaflet.current
    const m = map.current
    if (!L || !m) return

    for (const layer of layers.current) layer.remove()
    layers.current = []
    aircraft.current = null

    const origin = airportPoint(state.origin)
    const dest = airportPoint(state.dest)

    if (origin && dest) {
      const route = greatCirclePoints(origin, dest, 120)
      const flownCount = Math.max(1, Math.round(route.length * state.progress.fraction))

      // Flown solid, remaining dashed, both split so neither wraps the globe.
      addPolylines(L, m, layers.current, route.slice(0, flownCount), {
        color: 'hsl(38 92% 50%)',
        weight: 3,
        opacity: 0.95,
      })
      addPolylines(L, m, layers.current, route.slice(Math.max(0, flownCount - 1)), {
        color: 'hsl(220 10% 62%)',
        weight: 2,
        opacity: 0.7,
        dashArray: '6 8',
      })

      layers.current.push(airportMarker(L, m, origin, state.origin.iata, 'Departs'))
      layers.current.push(airportMarker(L, m, dest, state.dest.iata, 'Arrives'))
    }

    if (track.length > 1) {
      const trail = downsampleByTime(track).map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) }))
      addPolylines(L, m, layers.current, trail, {
        color: 'hsl(38 92% 50%)',
        weight: 1.5,
        opacity: 0.45,
      })
    }

    if (watcherHome) {
      layers.current.push(
        L.circleMarker([watcherHome.lat, watcherHome.lng], {
          radius: 5,
          color: 'hsl(173 58% 45%)',
          fillOpacity: 0.9,
        })
          .bindTooltip('Waiting here', { direction: 'top' })
          .addTo(m),
      )
    }

    const at = aircraftPoint(state)
    if (at) {
      const marker = L.marker([at.lat, at.lng], {
        icon: aircraftIcon(L, state),
        zIndexOffset: 1000,
        interactive: false,
      }).addTo(m)
      aircraft.current = marker
      layers.current.push(marker)
    }

    // Fit once per route change, and never while following — re-fitting under
    // someone's hand is the most annoying thing a map can do.
    if (!followAircraft && origin && dest) {
      const points: [number, number][] = [
        [origin.lat, origin.lng],
        [dest.lat, dest.lng],
      ]
      if (at) points.push([at.lat, at.lng])
      m.fitBounds(L.latLngBounds(points).pad(0.15), { animate: false, maxZoom: 7 })
    } else if (followAircraft && at) {
      m.panTo([at.lat, at.lng], { animate: !reducedMotion })
    }
    // `track` is compared by identity; it is refetched, not mutated.
  }, [state, track, watcherHome, followAircraft, reducedMotion])

  /**
   * Dead reckoning between fixes.
   *
   * Positions arrive a minute apart and the marker should not teleport, so it
   * is walked along its own heading at its own speed between them. Honest for
   * a minute; the moment the fix goes stale the confidence drops and the
   * marker's style changes to say so, rather than this quietly extrapolating
   * for an hour.
   */
  useEffect(() => {
    if (reducedMotion) return
    const position = state.position
    if (!position || position.confidence !== 'live') return
    if (!position.velocityMs || !position.headingDeg) return

    const startedAt = performance.now()
    const from = { lat: position.lat, lng: position.lng }

    const step = (frame: number) => {
      const marker = aircraft.current
      if (!marker) return
      const elapsedMs = frame - startedAt
      // Stop before the next fix would arrive; beyond that it is guessing.
      if (elapsedMs > 90_000) return

      const km = ((position.velocityMs ?? 0) * (elapsedMs / 1000)) / 1000
      const next = destinationPoint(from, position.headingDeg ?? 0, km)
      marker.setLatLng([next.lat, next.lng])
      if (props.current.followAircraft) map.current?.panTo([next.lat, next.lng], { animate: false })

      animation.current = requestAnimationFrame(step)
    }

    animation.current = requestAnimationFrame(step)
    return () => {
      if (animation.current) cancelAnimationFrame(animation.current)
    }
  }, [state.position, reducedMotion])

  return (
    <div
      ref={container}
      className={className}
      role="application"
      aria-label={`Map of ${state.flightNumber}`}
    />
  )
}

function addPolylines(
  L: typeof Leaflet,
  map: Leaflet.Map,
  sink: Leaflet.Layer[],
  points: LatLng[],
  options: Leaflet.PolylineOptions,
) {
  for (const segment of splitAtAntimeridian(points)) {
    if (segment.length < 2) continue
    sink.push(
      L.polyline(
        segment.map((p) => [p.lat, p.lng] as [number, number]),
        options,
      ).addTo(map),
    )
  }
}

function airportMarker(
  L: typeof Leaflet,
  map: Leaflet.Map,
  at: LatLng,
  iata: string | null,
  label: string,
): Leaflet.Layer {
  return L.circleMarker([at.lat, at.lng], {
    radius: 5,
    color: 'hsl(38 92% 50%)',
    fillColor: 'hsl(38 92% 50%)',
    fillOpacity: 1,
    weight: 2,
  })
    .bindTooltip(`${label} ${iata ?? ''}`.trim(), { direction: 'top' })
    .addTo(map)
}

function airportPoint(airport: FlightState['origin']): LatLng | null {
  if (airport.lat === null || airport.lng === null) return null
  return { lat: airport.lat, lng: airport.lng }
}

/** A real fix if there is one; otherwise a point along the route. */
function aircraftPoint(state: FlightState): LatLng | null {
  if (state.position && state.position.confidence !== 'estimated') {
    return { lat: state.position.lat, lng: state.position.lng }
  }
  if (state.phase === 'landed' || state.phase === 'cancelled') return null
  if (state.progress.fraction <= 0) return null

  const origin = airportPoint(state.origin)
  const dest = airportPoint(state.dest)
  if (!origin || !dest) return null

  return estimatedPosition(
    {
      origin_lat: origin.lat,
      origin_lng: origin.lng,
      dest_lat: dest.lat,
      dest_lng: dest.lng,
    } as never,
    state.progress.fraction,
  )
}

/**
 * The marker, styled by how much we actually know.
 *
 * Solid and rotated for a live fix. Half-opacity for a stale one. Hollow with
 * a dashed outline for an estimate — visibly a guess, at a glance, without
 * reading the label.
 */
function aircraftIcon(L: typeof Leaflet, state: FlightState): Leaflet.DivIcon {
  const confidence = state.position?.confidence ?? 'estimated'
  const heading = state.position?.headingDeg ?? 0
  const estimated = confidence === 'estimated' || !state.position

  const fill = estimated ? 'none' : 'hsl(38 92% 50%)'
  const stroke = estimated ? 'hsl(220 10% 70%)' : 'rgba(0,0,0,.55)'
  const dash = estimated ? 'stroke-dasharray="3 2"' : ''
  const opacity = confidence === 'stale' ? 0.5 : 1

  return L.divIcon({
    className: 'meridian-aircraft',
    html: `<span style="display:block;opacity:${opacity};transform:rotate(${heading}deg)">
        <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2 L14.5 11 L22 14 L22 16 L14 14.5 L13 20 L15.5 22 L15.5 23 L12 22 L8.5 23 L8.5 22 L11 20 L10 14.5 L2 16 L2 14 L9.5 11 Z"
                fill="${fill}" stroke="${stroke}" stroke-width="1.2" ${dash} />
        </svg>
      </span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  })
}
