import type { DateOnly } from '@/lib/dates'

/**
 * Which list a pin came from. Drives the layer toggles and the pin's shape.
 *
 * `stay` and `photo` were reserved from the start and left out because neither
 * module existed. Both do now, and a map of a trip that omits where they slept
 * and where they took pictures is showing the plan rather than the trip.
 */
export type PinLayer = 'itinerary' | 'pool' | 'wishlist' | 'stay' | 'photo'

export interface MapPin {
  id: string
  layer: PinLayer
  title: string
  lat: number
  lng: number
  /** Null on pool and wishlist pins — that is what makes them unscheduled. */
  date: DateOnly | null
  time: string | null
  categoryId: string | null
  /** Whose pick. Colours the pin. */
  personId: string | null
  state: string | null
  placeName: string | null
  address: string | null
  tripId: string | null
  tripTitle: string | null
  /** Position within its day, once a single day is selected. */
  order?: number
  /**
   * An explicit fill, for pins that are not anybody's pick.
   *
   * The journey overview draws airports and destinations, which belong to the
   * trip rather than to a person. Colouring them by `personId` would make them
   * the grey of "nobody chose this", which is true and useless — the thing
   * worth seeing there is what kind of stop it is.
   */
  color?: string
}

/** Anything with coordinates missing — counted, never silently dropped. */
export interface MapData {
  pins: MapPin[]
  /** Items that belong on the map but have no lat/lng yet (spec 6.3). */
  notOnMap: { id: string; title: string; layer: PinLayer }[]
}

export interface MapFilters {
  layers: Record<PinLayer, boolean>
  /** A single day, or null for every day. */
  day: DateOnly | null
  personId: string | null
  categoryId: string | null
  state: string | null
}

export interface GeocodeHit {
  name: string
  displayName: string
  lat: number
  lng: number
  countryCode: string | null
  /** Nominatim's own classification, useful for telling a café from a city. */
  kind: string | null
}

export interface Bounds {
  north: number
  south: number
  east: number
  west: number
}
