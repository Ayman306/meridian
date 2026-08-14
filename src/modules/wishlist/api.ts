/** Module 7 — Wishlist & Blend. Supabase access only. */
'use client'

import { supabase } from '@/lib/supabase/client'
import { AppError, toAppError, unwrap, unwrapList } from '@/lib/errors'
import { keyBetween } from '@/lib/fractional'
import type { InsertDto, UpdateDto } from '@/types/database'
import type { TrayDraft } from '@/types/domain'
import { extractResponseSchema, type ExtractResult } from './schemas'
import type { Draft, Verdict, WishlistItem, WishlistItemWithVerdicts } from './types'

export async function listWishlist(coupleId: string): Promise<WishlistItemWithVerdicts[]> {
  const items = unwrapList(
    await supabase
      .from('wishlist_items')
      .select('*')
      .eq('couple_id', coupleId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
  )
  if (items.length === 0) return []

  const verdicts = unwrapList(
    await supabase
      .from('wishlist_verdicts')
      .select('*')
      .in(
        'wishlist_id',
        items.map((i) => i.id),
      ),
  )

  const byItem = new Map<string, typeof verdicts>()
  for (const v of verdicts) {
    const list = byItem.get(v.wishlist_id) ?? []
    list.push(v)
    byItem.set(v.wishlist_id, list)
  }

  return items.map((item) => ({ ...item, verdicts: byItem.get(item.id) ?? [] }))
}

export type WishlistInput = Omit<
  InsertDto<'wishlist_items'>,
  'couple_id' | 'user_id' | 'id' | 'deleted_at'
>

export async function addWishlistItem(
  coupleId: string,
  userId: string,
  input: WishlistInput,
): Promise<WishlistItem> {
  return unwrap(
    await supabase
      .from('wishlist_items')
      .insert({ ...input, couple_id: coupleId, user_id: userId })
      .select('*')
      .single(),
  )
}

export async function updateWishlistItem(
  id: string,
  patch: UpdateDto<'wishlist_items'>,
): Promise<WishlistItem> {
  return unwrap(
    await supabase.from('wishlist_items').update(patch).eq('id', id).select('*').single(),
  )
}

export async function deleteWishlistItem(id: string): Promise<void> {
  const { error } = await supabase
    .from('wishlist_items')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw toAppError(error)
}

/**
 * Cast or change a verdict on the partner's save.
 *
 * Upsert rather than insert-or-update: changing your mind is one click with no
 * confirmation (spec 7.2), so this has to be idempotent.
 */
export async function setVerdict(
  wishlistId: string,
  userId: string,
  verdict: Verdict,
): Promise<void> {
  const { error } = await supabase
    .from('wishlist_verdicts')
    .upsert({ wishlist_id: wishlistId, user_id: userId, verdict }, { onConflict: 'wishlist_id,user_id' })
  if (error) throw toAppError(error)
}

export async function clearVerdict(wishlistId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('wishlist_verdicts')
    .delete()
    .eq('wishlist_id', wishlistId)
    .eq('user_id', userId)
  if (error) throw toAppError(error)
}

/**
 * Push saves into a trip's idea pool.
 *
 * Returns which ones were skipped as duplicates so the caller can say so —
 * spec 7.6 asks for a warning, not a silent second copy. Keys are generated
 * here because fractional indexing lives in `lib/fractional.ts` and nowhere
 * else; each push takes the previous key as its left neighbour so a bulk push
 * lands in order.
 */
export async function pushToItinerary(
  itemIds: readonly string[],
  tripId: string,
): Promise<{ pushed: string[]; skipped: string[] }> {
  const tail = unwrapList(
    await supabase
      .from('itinerary_items')
      .select('sort_key')
      .eq('trip_id', tripId)
      .is('scheduled_date', null)
      .is('deleted_at', null)
      .order('sort_key', { ascending: false })
      .limit(1),
  )

  let previous = tail[0]?.sort_key ?? null
  const pushed: string[] = []
  const skipped: string[] = []

  for (const id of itemIds) {
    const sortKey = keyBetween(previous, null)
    const { data, error } = await supabase.rpc('push_wishlist_to_itinerary', {
      wishlist_item_id: id,
      target_trip_id: tripId,
      new_sort_key: sortKey,
    })
    if (error) throw toAppError(error)

    if (data) {
      pushed.push(id)
      previous = sortKey
    } else {
      // Already in the pool. Not an error — just nothing to do.
      skipped.push(id)
    }
  }

  return { pushed, skipped }
}

/**
 * Read a pasted link's OpenGraph tags.
 *
 * Through our own Route Handler, not the browser: CORS blocks a cross-origin
 * fetch of an arbitrary page, and the spec's non-negotiable #2 keeps outbound
 * third-party calls on the server anyway. Failure is not an error the user
 * needs to see — they can type the title.
 */
export async function extractFromUrl(url: string): Promise<ExtractResult | null> {
  try {
    const res = await fetch('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    })
    if (!res.ok) return null
    const parsed = extractResponseSchema.safeParse(await res.json())
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/**
 * Put a generated plan in the tray.
 *
 * Non-negotiable #5: nothing auto-inserts. The generator is pure and runs in
 * the browser, so this is the only write it makes, and it lands in a table the
 * itinerary never reads from without the user saying so.
 */
export async function saveDraftToTray(
  coupleId: string,
  tripId: string,
  draft: Draft,
  pace: string,
): Promise<void> {
  if (draft.days.length === 0) {
    throw new AppError('There was nothing to plan with.', { kind: 'validation' })
  }

  const payload: TrayDraft = {
    kind: 'draft',
    pace,
    note: draft.note,
    openDays: draft.openDays,
    days: draft.days.map((day) => ({
      date: day.date,
      items: day.items.map((item) => ({
        wishlist_id: item.id,
        title: item.title,
        place_name: item.place_name,
        lat: item.lat === null ? null : Number(item.lat),
        lng: item.lng === null ? null : Number(item.lng),
        address: item.address,
        maps_url: item.maps_url,
        category_id: item.category_id,
        notes: item.notes,
        url: item.url,
        proposed_by: item.user_id,
      })),
    })),
  }

  const { error } = await supabase.from('suggestion_tray').insert({
    couple_id: coupleId,
    trip_id: tripId,
    source: 'blend',
    // jsonb, and TrayDraft is plain JSON — the cast is the type system catching
    // up with a shape it cannot see inside.
    payload: payload as unknown as InsertDto<'suggestion_tray'>['payload'],
  })
  if (error) throw toAppError(error)
}
