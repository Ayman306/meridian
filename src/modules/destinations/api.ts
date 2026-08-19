/** Module 4 — Destinations. Supabase access only. */
'use client'

import { supabase } from '@/lib/supabase/client'
import { toAppError, unwrap, unwrapList, unwrapMaybe } from '@/lib/errors'
import { keyBetween } from '@/lib/fractional'
import { zoneFor } from '@/lib/zones'
import { haversineKm } from '@/lib/utils'
import type { InsertDto, UpdateDto } from '@/types/database'
import type { ScoreWeights, TripDestination, VisaRule } from './types'
import { parseWeights, ZERO_WEIGHTS } from './logic'

export async function listDestinations(tripId: string): Promise<TripDestination[]> {
  return unwrapList(
    await supabase
      .from('trip_destinations')
      .select('*')
      .eq('trip_id', tripId)
      .is('deleted_at', null)
      .order('sort_key'),
  )
}

export type CandidateInput = Omit<
  InsertDto<'trip_destinations'>,
  'couple_id' | 'trip_id' | 'sort_key' | 'id'
>

export async function addCandidate(
  coupleId: string,
  tripId: string,
  userId: string,
  input: CandidateInput,
): Promise<TripDestination> {
  const tail = unwrapList(
    await supabase
      .from('trip_destinations')
      .select('sort_key')
      .eq('trip_id', tripId)
      .is('deleted_at', null)
      .order('sort_key', { ascending: false })
      .limit(1),
  )

  // Resolved here rather than in the form, so every path that adds a candidate
  // gets it — including the MCP's add_destination. `choose_destination` copies
  // this onto the trip, and a trip whose timezone is wrong reads every
  // itinerary time wrong, so it is worth the extra round trip once.
  const timezone =
    input.timezone ??
    (input.lat !== null && input.lat !== undefined && input.lng !== null && input.lng !== undefined
      ? await timezoneNear(Number(input.lat), Number(input.lng)).catch(() => null)
      : null)

  return unwrap(
    await supabase
      .from('trip_destinations')
      .insert({
        ...input,
        timezone,
        couple_id: coupleId,
        trip_id: tripId,
        created_by: userId,
        sort_key: keyBetween(tail[0]?.sort_key ?? null, null),
      })
      .select('*')
      .single(),
  )
}

export async function updateDestination(
  id: string,
  patch: UpdateDto<'trip_destinations'>,
): Promise<TripDestination> {
  return unwrap(
    await supabase.from('trip_destinations').update(patch).eq('id', id).select('*').single(),
  )
}

export async function removeDestination(id: string): Promise<void> {
  const { error } = await supabase
    .from('trip_destinations')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw toAppError(error)
}

/**
 * Choosing is three writes — this one chosen, the rest rejected, the trip's
 * timezone set — so it goes through the RPC that does them together.
 */
export async function chooseDestination(id: string): Promise<void> {
  // Backfill for candidates added before the zone lookup existed, or added
  // without coordinates and given some later. The RPC copies whatever is on
  // the row onto the trip, so filling it first is the only chance.
  const existing = unwrapMaybe(
    await supabase
      .from('trip_destinations')
      .select('timezone, lat, lng')
      .eq('id', id)
      .maybeSingle(),
  )

  if (existing && !existing.timezone && existing.lat !== null && existing.lng !== null) {
    const timezone = await timezoneNear(Number(existing.lat), Number(existing.lng)).catch(
      () => null,
    )
    if (timezone) {
      await supabase.from('trip_destinations').update({ timezone }).eq('id', id)
    }
  }

  const { error } = await supabase.rpc('choose_destination', { destination_id: id })
  if (error) throw toAppError(error)
}

export async function unchooseDestination(id: string): Promise<void> {
  const { error } = await supabase.rpc('unchoose_destination', { destination_id: id })
  if (error) throw toAppError(error)
}

/**
 * Rules for the passports in play against the countries on the board.
 *
 * Fetched by pair rather than as a whole table: the seed is small today, but a
 * reference table is exactly the kind of thing that grows to thousands of rows
 * without anyone noticing the client downloading it.
 */
export async function listVisaRules(
  passports: readonly string[],
  destinationCountries: readonly (string | null)[],
): Promise<VisaRule[]> {
  const uniquePassports = [...new Set(passports.filter(Boolean).map((p) => p.toUpperCase()))]
  if (uniquePassports.length === 0) return []

  const targets = new Set<string>()
  for (const country of destinationCountries) {
    if (!country) continue
    targets.add(country.toUpperCase())
    const zone = zoneFor(country)
    if (zone) targets.add(zone)
  }
  if (targets.size === 0) return []

  return unwrapList(
    await supabase
      .from('visa_rules')
      .select('*')
      .in('passport_country', uniquePassports)
      .in('destination_country', [...targets]),
  )
}

/** Cached durations for the origin/destination airports on the board. */
export async function listAirportRoutes(origins: readonly string[]): Promise<
  { origin_iata: string; dest_iata: string; duration_minutes: number; is_direct: boolean }[]
> {
  const clean = [...new Set(origins.filter(Boolean).map((o) => o.toUpperCase()))]
  if (clean.length === 0) return []
  return unwrapList(await supabase.from('airport_routes').select('*').in('origin_iata', clean))
}

export async function getWeights(coupleId: string): Promise<ScoreWeights> {
  const { data, error } = await supabase
    .from('destination_weights')
    .select('weights')
    .eq('couple_id', coupleId)
    .maybeSingle()

  if (error) throw toAppError(error)
  return data ? parseWeights(data.weights) : ZERO_WEIGHTS
}

export async function saveWeights(coupleId: string, weights: ScoreWeights): Promise<void> {
  const { error } = await supabase
    .from('destination_weights')
    .upsert(
      { couple_id: coupleId, weights: weights as unknown as never },
      { onConflict: 'couple_id' },
    )
  if (error) throw toAppError(error)
}

/** How many wishlist saves sit in each candidate city. One query, not N. */
export async function wishlistCountsByCity(coupleId: string): Promise<Record<string, number>> {
  const rows = unwrapList(
    await supabase
      .from('wishlist_items')
      .select('city')
      .eq('couple_id', coupleId)
      .is('deleted_at', null),
  )

  const counts: Record<string, number> = {}
  for (const row of rows) {
    if (!row.city) continue
    const key = row.city.trim().toLowerCase()
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}

/**
 * The country of a trip's chosen destination, or null.
 *
 * Chosen, not candidate: a shortlist of four cities has no one country, and
 * answering with the first would be a guess presented as a fact. Small and
 * indexed, so callers that need it on a hot screen can just ask.
 */
export async function getChosenCountry(tripId: string): Promise<string | null> {
  const rows = unwrapList(
    await supabase
      .from('trip_destinations')
      .select('country_code')
      .eq('trip_id', tripId)
      .eq('state', 'chosen')
      .is('deleted_at', null)
      .limit(1),
  )
  return rows[0]?.country_code ?? null
}

/**
 * The IANA timezone for a coordinate, from the nearest listed airport.
 *
 * Choosing a destination sets the trip's timezone, and until now that only
 * happened when the candidate already carried one — which the city search does
 * not return. Every itinerary time on a trip is read in that zone, so leaving
 * it unset is not cosmetic.
 *
 * ## Why the airport table rather than `tz-lookup`
 *
 * `tz-lookup` ships a polygon dataset around 100 KB. Correct, and a hundred
 * kilobytes in a PWA bundle for a lookup that happens once per trip is a poor
 * trade. The airports table is already loaded, already carries IANA zones, and
 * a city that anybody flies to has an airport near it — which is the entire
 * population of things this is asked about.
 *
 * ## Why it refuses rather than guesses
 *
 * Past `MAX_NEAREST_KM` the nearest airport is likely across a zone boundary,
 * and a wrong timezone silently shifts every time on the trip by an hour or
 * more. That is far worse than an unset one, which the app already handles.
 * So a remote coordinate returns null and the trip keeps whatever it had.
 */
const MAX_NEAREST_KM = 500

export async function timezoneNear(lat: number, lng: number): Promise<string | null> {
  // A degree of latitude is ~111 km, so this box comfortably contains the
  // radius and keeps the query off a full table scan. Longitude degrees narrow
  // towards the poles, which only makes the box wider than needed — never
  // narrower, so nothing inside the radius is excluded.
  const pad = MAX_NEAREST_KM / 111

  const candidates = unwrapList(
    await supabase
      .from('airports')
      .select('lat, lng, timezone')
      .gte('lat', lat - pad)
      .lte('lat', lat + pad)
      .gte('lng', lng - pad * 2)
      .lte('lng', lng + pad * 2),
  )

  let best: { timezone: string; km: number } | null = null
  for (const airport of candidates) {
    const km = haversineKm({ lat, lng }, { lat: Number(airport.lat), lng: Number(airport.lng) })
    if (km <= MAX_NEAREST_KM && (!best || km < best.km)) {
      best = { timezone: airport.timezone, km }
    }
  }

  return best?.timezone ?? null
}
