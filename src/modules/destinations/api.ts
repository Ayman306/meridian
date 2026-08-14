/** Module 4 — Destinations. Supabase access only. */
'use client'

import { supabase } from '@/lib/supabase/client'
import { toAppError, unwrap, unwrapList } from '@/lib/errors'
import { keyBetween } from '@/lib/fractional'
import { zoneFor } from '@/lib/zones'
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

  return unwrap(
    await supabase
      .from('trip_destinations')
      .insert({
        ...input,
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
