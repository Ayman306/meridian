/**
 * Photos — what exists, not the pictures themselves.
 *
 * Captions, dates, which trip, whether it is a favourite. Never a file and
 * never a link to one: `path_original` and `path_thumb` are keys into a private
 * bucket, and the app reaches them through signed URLs that expire in 300
 * seconds (non-negotiable #3). Minting one into a model's context would keep a
 * credential alive well past the window it was scoped to, and no question worth
 * asking here needs the bytes.
 *
 * No upload tool either, for the obvious reason: a photo cannot come from a
 * conversation.
 */
import { z } from 'zod'
import { defineTool, requireCouple } from './types'
import type { AnyTool } from './types'

const listPhotos = defineTool({
  name: 'list_photos',
  module: 'photos',
  title: 'List photos',
  description:
    'Photos in the shared gallery, with captions and dates. Metadata only — no images and no links are available through this. Useful for "what did we do in Mangalore" from captions and dates.',
  readOnly: true,
  inputSchema: z.object({
    trip_id: z.string().uuid().nullable().default(null).describe('Restrict to one trip.'),
    favourites_only: z.boolean().default(false).describe('Only the ones marked favourite.'),
    limit: z.number().int().min(1).max(100).default(40).describe('How many to return, newest first.'),
  }),
  async handler(ctx, input) {
    requireCouple(ctx)

    // The column list is the boundary. `path_original` and `path_thumb` exist
    // on the row and are deliberately not selected.
    let query = ctx.supabase
      .from('media')
      .select('id, caption, media_type, taken_at, is_favorite, trip_id, lat, lng')
      .is('deleted_at', null)
      .order('taken_at', { ascending: false, nullsFirst: false })
      .limit(input.limit)

    if (input.trip_id) query = query.eq('trip_id', input.trip_id)
    if (input.favourites_only) query = query.eq('is_favorite', true)

    const { data, error } = await query
    if (error) throw new Error(error.message)

    const rows = data ?? []
    if (rows.length === 0) return 'No photos match that.'

    return rows
      .map((row) => {
        const parts = [row.taken_at?.slice(0, 10) ?? 'no date']
        parts.push(row.caption ?? '(no caption)')
        if (row.media_type && row.media_type !== 'photo') parts.push(row.media_type)
        if (row.is_favorite) parts.push('favourite')
        if (row.lat !== null && row.lng !== null) parts.push('has a location')
        return `- ${parts.join(' · ')}`
      })
      .join('\n')
  },
})

const listAlbums = defineTool({
  name: 'list_albums',
  module: 'photos',
  title: 'List albums',
  description: 'The albums photos are grouped into, and which trip each belongs to.',
  readOnly: true,
  inputSchema: z.object({
    trip_id: z.string().uuid().nullable().default(null).describe('Restrict to one trip.'),
  }),
  async handler(ctx, input) {
    requireCouple(ctx)

    let query = ctx.supabase
      .from('albums')
      .select('id, title, kind, trip_id, created_at')
      .order('sort_order', { ascending: true })

    if (input.trip_id) query = query.eq('trip_id', input.trip_id)

    const { data, error } = await query
    if (error) throw new Error(error.message)

    const rows = data ?? []
    if (rows.length === 0) return 'No albums.'

    return rows.map((row) => `- ${row.title} (${row.kind}) — ${row.id}`).join('\n')
  },
})

export const galleryTools: AnyTool[] = [listPhotos, listAlbums]
