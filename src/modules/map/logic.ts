/**
 * Pure functions for Module 6 — Map.
 *
 * Everything here runs without Leaflet loaded: filtering, bounds, the day
 * route and the Google Maps deep link are all arithmetic and strings. The
 * Leaflet-specific code lives in the canvas component, which is the only part
 * that cannot be unit-tested.
 */
import { haversineKm, type LatLng } from '@/lib/utils'
import type { DateOnly } from '@/lib/dates'
import type { Bounds, MapFilters, MapPin } from './types'

/** Below this, Leaflet clusters; above it, individual pins (spec 6.3). */
export const CLUSTER_MAX_ZOOM = 13

/**
 * Pins spanning continents would otherwise fit-bounds to a zoom where the tile
 * layer repeats and the map reads as broken (spec 6.6).
 */
export const MIN_ZOOM = 2
export const MAX_ZOOM = 18

/** Somewhere in the Atlantic — the fallback when there is nothing to show. */
export const WORLD_CENTER: LatLng = { lat: 20, lng: 0 }

export const DEFAULT_FILTERS: MapFilters = {
  layers: { itinerary: true, pool: true, wishlist: true },
  day: null,
  personId: null,
  categoryId: null,
  state: null,
}

/**
 * A Google Maps link built from coordinates first.
 *
 * Spec 6.3 is explicit about the order: a name alone resolves to the wrong
 * city often enough to matter, and the whole reason for the link is standing
 * in one city wanting directions in that city.
 */
export function googleMapsUrl(pin: {
  title: string
  placeName?: string | null
  lat: number | null
  lng: number | null
}): string {
  const base = 'https://www.google.com/maps/search/?api=1&query='
  if (pin.lat !== null && pin.lng !== null) return `${base}${pin.lat},${pin.lng}`
  return `${base}${encodeURIComponent(pin.placeName || pin.title)}`
}

export function applyFilters(pins: readonly MapPin[], filters: MapFilters): MapPin[] {
  const kept = pins.filter((pin) => {
    if (!filters.layers[pin.layer]) return false
    if (filters.personId && pin.personId !== filters.personId) return false
    if (filters.categoryId && pin.categoryId !== filters.categoryId) return false
    if (filters.state && pin.state !== filters.state) return false
    // A day filter is about the itinerary. Unscheduled pins have no day to
    // match, so they drop out rather than cluttering a single-day view.
    if (filters.day && pin.date !== filters.day) return false
    return true
  })

  // Numbering only means something when one day is on screen; a number on a
  // pin from a different day would be a second sequence with the same digits.
  return filters.day ? kept.map((pin, i) => ({ ...pin, order: i + 1 })) : kept
}

export function boundsOf(pins: readonly { lat: number; lng: number }[]): Bounds | null {
  if (pins.length === 0) return null

  let north = -90
  let south = 90
  let east = -180
  let west = 180

  for (const p of pins) {
    north = Math.max(north, p.lat)
    south = Math.min(south, p.lat)
    east = Math.max(east, p.lng)
    west = Math.min(west, p.lng)
  }

  return { north, south, east, west }
}

/** Padded, and never degenerate — a single pin would otherwise zoom to a point. */
export function paddedBounds(bounds: Bounds, minSpan = 0.01): Bounds {
  const latSpan = Math.max(bounds.north - bounds.south, minSpan)
  const lngSpan = Math.max(bounds.east - bounds.west, minSpan)
  const latPad = latSpan * 0.12
  const lngPad = lngSpan * 0.12
  const latMid = (bounds.north + bounds.south) / 2
  const lngMid = (bounds.east + bounds.west) / 2

  return {
    north: Math.min(90, latMid + latSpan / 2 + latPad),
    south: Math.max(-90, latMid - latSpan / 2 - latPad),
    east: Math.min(180, lngMid + lngSpan / 2 + lngPad),
    west: Math.max(-180, lngMid - lngSpan / 2 - lngPad),
  }
}

/**
 * The straight-line total for a day's route.
 *
 * Straight lines, not roads: routing needs a keyed API, and the spec would
 * rather show an honest approximation than pay for one. The label the UI puts
 * next to this number has to say "as the crow flies" — a distance presented as
 * walking distance that isn't would be worse than no number at all.
 */
export function routeDistanceKm(pins: readonly MapPin[]): number {
  let total = 0
  for (let i = 0; i < pins.length - 1; i++) {
    total += haversineKm(pins[i]!, pins[i + 1]!)
  }
  return total
}

export function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`
}

/** Every day that has at least one pin, in order. Drives the day filter. */
export function daysWithPins(pins: readonly MapPin[]): DateOnly[] {
  const days = new Set<DateOnly>()
  for (const pin of pins) if (pin.date) days.add(pin.date)
  return [...days].sort()
}

/** The line for the selected day, in itinerary order. */
export function dayRoute(pins: readonly MapPin[], day: DateOnly | null): MapPin[] {
  if (!day) return []
  return pins.filter((p) => p.date === day && p.layer === 'itinerary')
}

/**
 * Where to open the map when there is nothing to fit to.
 *
 * A blank map at world zoom says "broken". A blank map over the destination
 * says "nothing here yet", which is the truth (spec 6.6).
 */
export function fallbackCenter(destination: LatLng | null): LatLng {
  return destination ?? WORLD_CENTER
}
