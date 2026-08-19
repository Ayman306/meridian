/** Module 6 — Map. Supabase access only; the Nominatim call lives in lib. */
'use client'

import { supabase } from '@/lib/supabase/client'
import { toAppError, unwrapList } from '@/lib/errors'
import type { PlaceResult } from '@/lib/geocode'
import type { MapData, MapPin } from './types'

/**
 * Every place with coordinates, for one trip or for all of them.
 *
 * Three selects rather than a view: the tables have different shapes and
 * different RLS, and a join would make the "not on map" count — which needs the
 * rows *without* coordinates — harder to get right than it is worth.
 */
export async function getMapData(coupleId: string, tripId: string | null): Promise<MapData> {
  const itineraryQuery = supabase
    .from('itinerary_items')
    .select('id, title, lat, lng, scheduled_date, start_time, category_id, proposed_by, state, place_name, address, trip_id')
    .eq('couple_id', coupleId)
    .is('deleted_at', null)
  if (tripId) itineraryQuery.eq('trip_id', tripId)

  const wishlistQuery = supabase
    .from('wishlist_items')
    .select('id, title, lat, lng, category_id, user_id, place_name, address, city')
    .eq('couple_id', coupleId)
    .is('deleted_at', null)

  // Where they slept. Scoped the same way the itinerary is — on a trip map,
  // that trip's bookings; on the all-time map, all of them.
  const stayQuery = supabase
    .from('accommodations')
    .select('id, name, lat, lng, address, city, check_in, trip_id, created_by')
    .eq('couple_id', coupleId)
    .is('deleted_at', null)
  if (tripId) stayQuery.eq('trip_id', tripId)

  // And where they took pictures. Only ones that carry a location, and capped:
  // a trip with three hundred geotagged photos would put three hundred markers
  // on top of the plan, and the layer is off by default for the same reason.
  const photoQuery = supabase
    .from('media')
    .select('id, caption, lat, lng, taken_at, trip_id, uploader_id')
    .eq('couple_id', coupleId)
    .is('deleted_at', null)
    .not('lat', 'is', null)
    .order('taken_at', { ascending: false })
    .limit(300)
  if (tripId) photoQuery.eq('trip_id', tripId)

  const [items, saves, trips, stays, photos] = await Promise.all([
    itineraryQuery,
    // A trip map is about that trip; the whole wishlist would swamp it with
    // places from other cities. The all-time map wants everything.
    tripId ? Promise.resolve(null) : wishlistQuery,
    tripId
      ? Promise.resolve(null)
      : supabase.from('trips').select('id, title').eq('couple_id', coupleId).is('deleted_at', null),
    stayQuery,
    photoQuery,
  ])

  const itineraryRows = unwrapList(items)
  const wishlistRows = saves ? unwrapList(saves) : []
  const tripTitles = new Map((trips ? unwrapList(trips) : []).map((t) => [t.id, t.title]))

  const pins: MapPin[] = []
  const notOnMap: MapData['notOnMap'] = []

  for (const row of itineraryRows) {
    const layer = row.scheduled_date ? 'itinerary' : 'pool'
    if (row.lat === null || row.lng === null) {
      notOnMap.push({ id: row.id, title: row.title, layer })
      continue
    }
    pins.push({
      id: row.id,
      layer,
      title: row.title,
      lat: Number(row.lat),
      lng: Number(row.lng),
      date: row.scheduled_date,
      time: row.start_time,
      categoryId: row.category_id,
      personId: row.proposed_by,
      state: row.state,
      placeName: row.place_name,
      address: row.address,
      tripId: row.trip_id,
      tripTitle: tripTitles.get(row.trip_id) ?? null,
    })
  }

  for (const row of wishlistRows) {
    if (row.lat === null || row.lng === null) {
      notOnMap.push({ id: row.id, title: row.title, layer: 'wishlist' })
      continue
    }
    pins.push({
      id: row.id,
      layer: 'wishlist',
      title: row.title,
      lat: Number(row.lat),
      lng: Number(row.lng),
      date: null,
      time: null,
      categoryId: row.category_id,
      personId: row.user_id,
      state: null,
      placeName: row.place_name,
      address: row.address,
      tripId: null,
      tripTitle: row.city,
    })
  }

  for (const row of unwrapList(stays)) {
    if (row.lat === null || row.lng === null) {
      notOnMap.push({ id: row.id, title: row.name, layer: 'stay' })
      continue
    }
    pins.push({
      id: `stay:${row.id}`,
      layer: 'stay',
      title: row.name,
      lat: Number(row.lat),
      lng: Number(row.lng),
      // The check-in date, so the stay sorts into the trip at the point they
      // arrived rather than at the front with everything undated.
      date: row.check_in,
      time: null,
      categoryId: null,
      // A booking belongs to the couple rather than to whoever typed it in, so
      // it takes the neutral colour rather than one person's accent.
      personId: null,
      state: null,
      placeName: row.city,
      address: row.address,
      tripId: row.trip_id,
      tripTitle: row.trip_id ? (tripTitles.get(row.trip_id) ?? null) : null,
    })
  }

  for (const row of unwrapList(photos)) {
    pins.push({
      id: `photo:${row.id}`,
      layer: 'photo',
      title: row.caption ?? 'Photo',
      lat: Number(row.lat),
      lng: Number(row.lng),
      date: row.taken_at ? row.taken_at.slice(0, 10) : null,
      time: null,
      categoryId: null,
      personId: row.uploader_id,
      state: null,
      placeName: null,
      address: null,
      tripId: row.trip_id,
      tripTitle: row.trip_id ? (tripTitles.get(row.trip_id) ?? null) : null,
    })
  }

  // Scheduled first, so the pins that matter draw on top of the ideas.
  pins.sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'))
  return { pins, notOnMap }
}

// ---------------------------------------------------------------------------
// Geocode cache (spec 6.3)
//
// Nominatim asks for at most one request a second and for results to be
// cached. The cache is shared across the whole app rather than per couple:
// "lisbon" is "lisbon" for everyone, and the table holds nothing about who
// searched.
// ---------------------------------------------------------------------------

/** Cache entries stop being trusted after this long. Places do move. */
const CACHE_TTL_DAYS = 30

export function cacheKey(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, ' ')
}

export async function readGeocodeCache(query: string): Promise<PlaceResult[] | null> {
  const { data, error } = await supabase
    .from('geocode_cache')
    .select('results, cached_at')
    .eq('query', cacheKey(query))
    .maybeSingle()

  // A cache miss is not a failure, and neither is a cache that is unreachable.
  if (error || !data) return null

  const age = Date.now() - new Date(data.cached_at).getTime()
  if (age > CACHE_TTL_DAYS * 86_400_000) return null

  return Array.isArray(data.results) ? (data.results as unknown as PlaceResult[]) : null
}

export async function writeGeocodeCache(query: string, results: PlaceResult[]): Promise<void> {
  const { error } = await supabase.from('geocode_cache').upsert(
    {
      query: cacheKey(query),
      results: results as unknown as never,
      cached_at: new Date().toISOString(),
    },
    { onConflict: 'query' },
  )
  // Failing to cache is not worth failing the search over.
  if (error) console.warn('geocode cache write failed', toAppError(error).message)
}
