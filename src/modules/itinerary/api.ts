/** Module 5 — Itinerary. Supabase access only. */
'use client'

import { supabase } from '@/lib/supabase/client'
import { AppError, toAppError, unwrap, unwrapList } from '@/lib/errors'
import { keyBetween } from '@/lib/fractional'
import type { DateOnly } from '@/lib/dates'
import type { Category, ItineraryItem, Suggestion } from './types'
import type { InsertDto, UpdateDto } from '@/types/database'
import type { TrayDraft } from '@/types/domain'

export async function listCategories(coupleId: string): Promise<Category[]> {
  const rows = unwrapList(
    await supabase
      .from('categories')
      .select('*')
      .eq('couple_id', coupleId)
      .order('sort_order', { ascending: true }),
  )
  if (rows.length > 0) return rows

  // Seed on first read, so a couple created before this migration still works.
  const { error } = await supabase.rpc('seed_categories', { target: coupleId })
  if (error) throw toAppError(error)
  return unwrapList(
    await supabase
      .from('categories')
      .select('*')
      .eq('couple_id', coupleId)
      .order('sort_order', { ascending: true }),
  )
}

export async function listItems(tripId: string): Promise<ItineraryItem[]> {
  return unwrapList(
    await supabase
      .from('itinerary_items')
      .select('*')
      .eq('trip_id', tripId)
      .is('deleted_at', null)
      .order('sort_key', { ascending: true }),
  )
}

export interface CreateItemInput {
  couple_id: string
  trip_id: string
  title: string
  scheduled_date?: DateOnly | null
  start_time?: string | null
  end_time?: string | null
  duration_minutes?: number | null
  place_name?: string | null
  lat?: number | null
  lng?: number | null
  address?: string | null
  maps_url?: string | null
  category_id?: string | null
  notes?: string | null
  url?: string | null
  cost_estimate?: number | null
  currency?: string | null
  proposed_by?: string | null
  source?: string
  /** Sort key of the item this should land after. Omit to append. */
  afterKey?: string | null
}

export async function createItem(input: CreateItemInput): Promise<ItineraryItem> {
  const { afterKey, ...rest } = input
  const sortKey = afterKey !== undefined ? keyBetween(afterKey, null) : await nextKeyFor(input)

  const payload: InsertDto<'itinerary_items'> = {
    ...rest,
    scheduled_date: input.scheduled_date ?? null,
    // A time with no date is meaningless; the DB constraint agrees.
    start_time: input.scheduled_date ? (input.start_time ?? null) : null,
    end_time: input.scheduled_date ? (input.end_time ?? null) : null,
    source: input.source ?? 'manual',
    sort_key: sortKey,
  }

  return unwrap(await supabase.from('itinerary_items').insert(payload).select('*').single())
}

/** The key that puts a new item at the end of its target list. */
async function nextKeyFor(input: Pick<CreateItemInput, 'trip_id' | 'scheduled_date'>): Promise<string> {
  let query = supabase
    .from('itinerary_items')
    .select('sort_key')
    .eq('trip_id', input.trip_id)
    .is('deleted_at', null)
    .order('sort_key', { ascending: false })
    .limit(1)

  query = input.scheduled_date
    ? query.eq('scheduled_date', input.scheduled_date)
    : query.is('scheduled_date', null)

  const rows = unwrapList(await query)
  return keyBetween(rows[0]?.sort_key ?? null, null)
}

export async function updateItem(
  id: string,
  patch: UpdateDto<'itinerary_items'>,
): Promise<ItineraryItem> {
  return unwrap(
    await supabase.from('itinerary_items').update(patch).eq('id', id).select('*').single(),
  )
}

/**
 * Move an item onto a day, or between days, or reorder it within one.
 *
 * Always a single-row UPDATE: the new position is a fractional key computed
 * from its two new neighbours, so no sibling is ever rewritten.
 */
export async function moveItem(
  id: string,
  date: DateOnly | null,
  beforeKey: string | null,
  afterKey: string | null,
): Promise<ItineraryItem> {
  const patch: UpdateDto<'itinerary_items'> = {
    scheduled_date: date,
    sort_key: keyBetween(beforeKey, afterKey),
  }
  // Unscheduling drops the time with the date — "8pm on no particular day"
  // is not a thing, and the DB constraint would reject it anyway.
  if (date === null) {
    patch.start_time = null
    patch.end_time = null
  }
  return updateItem(id, patch)
}

/** Move several items to one day (or to the pool) in a single round trip. */
export async function bulkMove(ids: string[], date: DateOnly | null): Promise<void> {
  if (ids.length === 0) return
  const patch: UpdateDto<'itinerary_items'> = { scheduled_date: date }
  if (date === null) {
    patch.start_time = null
    patch.end_time = null
  }
  const { error } = await supabase.from('itinerary_items').update(patch).in('id', ids)
  if (error) throw toAppError(error)
}

/** Soft delete — restorable, because deleting the wrong idea is easy. */
export async function deleteItem(id: string): Promise<void> {
  const { error } = await supabase
    .from('itinerary_items')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw toAppError(error)
}

export async function restoreItem(id: string): Promise<void> {
  const { error } = await supabase
    .from('itinerary_items')
    .update({ deleted_at: null })
    .eq('id', id)
  if (error) throw toAppError(error)
}

/** How many items sit on each day. Asked before a trip's dates are shortened. */
export async function itemCountsByDay(tripId: string): Promise<Record<string, number>> {
  const { data, error } = await supabase.rpc('trip_item_counts_by_day', { target: tripId })
  if (error) throw toAppError(error)
  const out: Record<string, number> = {}
  for (const row of data ?? []) out[row.date] = Number(row.item_count)
  return out
}

// ---------------------------------------------------------------------------
// Suggestion tray — nothing generated ever auto-inserts (non-negotiable #5)
// ---------------------------------------------------------------------------

export async function listTray(tripId: string): Promise<Suggestion[]> {
  return unwrapList(
    await supabase
      .from('suggestion_tray')
      .select('*')
      .eq('trip_id', tripId)
      .is('accepted_at', null)
      .is('dismissed_at', null)
      .order('generated_at', { ascending: false }),
  )
}

/**
 * Take a suggestion into the plan.
 *
 * This is the *only* path from the tray to `itinerary_items`, and it runs
 * because someone pressed a button (non-negotiable #5). Everything in the
 * payload becomes a normal item with `source = 'blend'` — once accepted there
 * is nothing special about it, which is the point: a suggestion you kept is
 * just part of your plan.
 */
export async function acceptSuggestion(id: string): Promise<number> {
  const suggestion = unwrap(
    await supabase.from('suggestion_tray').select('*').eq('id', id).single(),
  )
  if (suggestion.accepted_at) return 0

  const draft = suggestion.payload as unknown as TrayDraft
  const days = Array.isArray(draft?.days) ? draft.days : []
  if (!suggestion.trip_id || days.length === 0) {
    throw new AppError('That suggestion has nothing in it.', { kind: 'validation' })
  }

  const rows: InsertDto<'itinerary_items'>[] = []
  // One continuous run of keys across the whole draft: every item is appended
  // after the last, so the order the generator chose survives the insert.
  let previous = await lastKeyIn(suggestion.trip_id)

  for (const day of days) {
    for (const item of day.items ?? []) {
      const sortKey = keyBetween(previous, null)
      previous = sortKey
      rows.push({
        couple_id: suggestion.couple_id,
        trip_id: suggestion.trip_id,
        title: item.title,
        place_name: item.place_name,
        lat: item.lat,
        lng: item.lng,
        address: item.address,
        maps_url: item.maps_url,
        category_id: item.category_id,
        notes: item.notes,
        url: item.url,
        proposed_by: item.proposed_by,
        scheduled_date: day.date,
        source: 'blend',
        sort_key: sortKey,
      })
    }
  }

  const { error } = await supabase.from('itinerary_items').insert(rows)
  if (error) throw toAppError(error)

  const marked = await supabase
    .from('suggestion_tray')
    .update({ accepted_at: new Date().toISOString() })
    .eq('id', id)
  if (marked.error) throw toAppError(marked.error)

  return rows.length
}

async function lastKeyIn(tripId: string): Promise<string | null> {
  const rows = unwrapList(
    await supabase
      .from('itinerary_items')
      .select('sort_key')
      .eq('trip_id', tripId)
      .is('deleted_at', null)
      .order('sort_key', { ascending: false })
      .limit(1),
  )
  return rows[0]?.sort_key ?? null
}

export async function dismissSuggestion(id: string): Promise<void> {
  const { error } = await supabase
    .from('suggestion_tray')
    .update({ dismissed_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw toAppError(error)
}
