/**
 * The Leaflet surface. The only file in the module that touches the library.
 *
 * Raw Leaflet rather than a React wrapper: clustering, custom pins and a route
 * line all want imperative calls, and wrapping them in components would mean
 * reconciling two trees that disagree about who owns the DOM. The library is
 * imported inside the effect because it reads `window` at module scope, which
 * is fatal during server rendering.
 */
'use client'

import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'

import { useEffect, useRef } from 'react'
import type * as Leaflet from 'leaflet'
import type { LatLng } from '@/lib/utils'
import { CLUSTER_MAX_ZOOM, MAX_ZOOM, MIN_ZOOM, boundsOf, googleMapsUrl, paddedBounds } from '../logic'
import type { MapPin } from '../types'

export interface MapCanvasProps {
  pins: MapPin[]
  /** Drawn as a line, in order, when a single day is selected. */
  route: MapPin[]
  center: LatLng
  /** Pin fill by whose pick it is. */
  colorFor: (personId: string | null) => string
  nameFor: (personId: string | null) => string
  onSelect?: (pin: MapPin) => void
  /** Long-press (or right-click) on empty map. */
  onPickLocation?: (at: LatLng) => void
  className?: string
}

export function MapCanvas({
  pins,
  route,
  center,
  colorFor,
  nameFor,
  onSelect,
  onPickLocation,
  className,
}: MapCanvasProps) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<Leaflet.Map | null>(null)
  const cluster = useRef<Leaflet.MarkerClusterGroup | null>(null)
  const line = useRef<Leaflet.Polyline | null>(null)
  const leaflet = useRef<typeof Leaflet | null>(null)

  // Handlers change on every render; the effects below must not tear the map
  // down because of it, so they read through a ref instead of depending on it.
  // Written in an effect rather than during render — a ref mutated mid-render
  // is a value React is entitled to throw away.
  const handlers = useRef({ colorFor, nameFor, onSelect, onPickLocation })
  useEffect(() => {
    handlers.current = { colorFor, nameFor, onSelect, onPickLocation }
  })

  // Create once. A re-created map loses the user's pan and zoom, which is the
  // most annoying thing a map can do while you are looking at it.
  useEffect(() => {
    let cancelled = false
    let created: Leaflet.Map | null = null

    void (async () => {
      const L = (await import('leaflet')).default
      await import('leaflet.markercluster')
      if (cancelled || !container.current || map.current) return

      leaflet.current = L
      created = L.map(container.current, {
        center: [center.lat, center.lng],
        zoom: 3,
        minZoom: MIN_ZOOM,
        maxZoom: MAX_ZOOM,
        zoomControl: true,
        // Keyboard panning is on by default; make sure the container can take
        // focus so it is reachable without a mouse.
        keyboard: true,
        worldCopyJump: true,
      })

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: MAX_ZOOM,
        // Required by the OSM tile usage policy, and it stays visible at every
        // zoom — it is not ours to hide.
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(created)

      cluster.current = L.markerClusterGroup({
        disableClusteringAtZoom: CLUSTER_MAX_ZOOM + 1,
        showCoverageOnHover: false,
        spiderfyOnMaxZoom: true,
      })
      created.addLayer(cluster.current)

      // Leaflet fires contextmenu for both right-click and touch long-press.
      created.on('contextmenu', (e: Leaflet.LeafletMouseEvent) => {
        handlers.current.onPickLocation?.({ lat: e.latlng.lat, lng: e.latlng.lng })
      })

      map.current = created
      // The container is often sized by a flex parent that settles a tick late.
      setTimeout(() => created?.invalidateSize(), 0)
    })()

    return () => {
      cancelled = true
      map.current?.remove()
      map.current = null
      cluster.current = null
      line.current = null
    }
    // Mount only. `center` is the initial view; later changes are handled by
    // the fit-bounds effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Pins, the route line, and the fit.
  useEffect(() => {
    const L = leaflet.current
    const m = map.current
    const group = cluster.current
    if (!L || !m || !group) return

    group.clearLayers()

    for (const pin of pins) {
      const marker = L.marker([pin.lat, pin.lng], {
        icon: L.divIcon({
          className: 'meridian-pin',
          html: pinHtml(pin, handlers.current.colorFor(pin.personId)),
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        }),
        title: pin.title,
        alt: pin.title,
        keyboard: true,
      })

      marker.bindPopup(popupHtml(pin, handlers.current.nameFor(pin.personId)))
      marker.on('click', () => handlers.current.onSelect?.(pin))
      group.addLayer(marker)
    }

    line.current?.remove()
    line.current = null
    if (route.length > 1) {
      line.current = L.polyline(
        route.map((p) => [p.lat, p.lng] as [number, number]),
        { color: 'hsl(38 92% 50%)', weight: 3, opacity: 0.85, dashArray: '6 6' },
      ).addTo(m)
    }

    const bounds = boundsOf(pins)
    if (bounds) {
      const padded = paddedBounds(bounds)
      m.fitBounds(
        [
          [padded.south, padded.west],
          [padded.north, padded.east],
        ],
        { maxZoom: 15, animate: false },
      )
    }
  }, [pins, route])

  return (
    <div
      ref={container}
      className={className}
      // Leaflet's own container is not announced usefully; the surrounding page
      // lists everything on the map in text, so this is a supplement, not the
      // only route to the data.
      role="application"
      aria-label="Map of saved places"
    />
  )
}

/** A coloured dot, numbered when the day filter put it in an order. */
function pinHtml(pin: MapPin, color: string): string {
  const dashed = pin.layer !== 'itinerary'
  return `<span style="
      display:flex;align-items:center;justify-content:center;
      width:28px;height:28px;border-radius:9999px;
      background:${escapeAttribute(color)};
      border:2px ${dashed ? 'dashed' : 'solid'} rgba(0,0,0,.45);
      box-shadow:0 1px 4px rgba(0,0,0,.4);
      font:600 12px/1 system-ui,sans-serif;color:rgba(0,0,0,.8);
    ">${pin.order ?? ''}</span>`
}

function popupHtml(pin: MapPin, personName: string): string {
  const lines = [
    `<strong>${escapeHtml(pin.title)}</strong>`,
    pin.date ? escapeHtml([pin.date, pin.time?.slice(0, 5)].filter(Boolean).join(' · ')) : null,
    pin.placeName && pin.placeName !== pin.title ? escapeHtml(pin.placeName) : null,
    personName ? escapeHtml(personName) : null,
    pin.tripTitle ? escapeHtml(pin.tripTitle) : null,
  ].filter(Boolean)

  return `<div style="min-width:160px;line-height:1.5">
      ${lines.join('<br>')}
      <br><a href="${escapeAttribute(googleMapsUrl(pin))}" target="_blank" rel="noreferrer noopener">Open in Google Maps</a>
    </div>`
}

/**
 * These strings become innerHTML inside Leaflet, so every interpolated value is
 * user data until it has been through here.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeAttribute(value: string): string {
  return escapeHtml(value)
}
