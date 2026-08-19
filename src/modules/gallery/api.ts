/** Module 11 — Gallery. Supabase access only. */
'use client'

import { supabase } from '@/lib/supabase/client'
import { toAppError, unwrap, unwrapList } from '@/lib/errors'
import type { InsertDto, UpdateDto } from '@/types/database'
import { PAGE_SIZE, SIGNED_URL_TTL_SECONDS, extensionFor, mediaPath } from './logic'
import type {
  Album,
  Media,
  MediaComment,
  MediaFilters,
  MediaPage,
  MediaUsage,
  MediaVariant,
  ShareLink,
  ShareOptions,
} from './types'

const BUCKET = 'media'

/**
 * A page of the library.
 *
 * Keyset pagination on `taken_at` rather than an offset: an offset re-reads
 * every earlier row on each page, and the library only grows. The cursor is
 * the last row's timestamp, so a photo uploaded mid-scroll cannot shift the
 * window and make one duplicate or disappear.
 */
export async function listMedia(
  coupleId: string,
  filters: MediaFilters = {},
  cursor: string | null = null,
): Promise<MediaPage> {
  let query = supabase
    .from('media')
    .select('*')
    .eq('couple_id', coupleId)
    .is('deleted_at', null)
    .order('taken_at', { ascending: false, nullsFirst: false })
    .limit(PAGE_SIZE)

  if (cursor) query = query.lt('taken_at', cursor)
  if (filters.tripId) query = query.eq('trip_id', filters.tripId)
  if (filters.uploaderId) query = query.eq('uploader_id', filters.uploaderId)
  if (filters.favouritesOnly) query = query.eq('is_favorite', true)
  if (filters.mediaType) query = query.eq('media_type', filters.mediaType)
  if (filters.hasLocation) query = query.not('lat', 'is', null)
  if (filters.from) query = query.gte('taken_at', filters.from)
  if (filters.to) query = query.lte('taken_at', filters.to)
  // Postgres full-text over captions, through the tsvector the trigger keeps.
  if (filters.search) query = query.textSearch('search_tsv', filters.search, { type: 'websearch' })

  const items = unwrapList(await query)
  return {
    items,
    // A short page is the end of the library; a full one might not be.
    cursor: items.length === PAGE_SIZE ? (items[items.length - 1]?.taken_at ?? null) : null,
  }
}

export async function listAlbumMedia(albumId: string): Promise<Media[]> {
  const rows = unwrapList(
    await supabase
      .from('album_media')
      .select('sort_key, media:media(*)')
      .eq('album_id', albumId)
      .order('sort_key'),
  )

  return rows
    .map((row) => row.media as unknown as Media | null)
    .filter((m): m is Media => Boolean(m) && m!.deleted_at === null)
}

export async function getMedia(id: string): Promise<Media> {
  return unwrap(await supabase.from('media').select('*').eq('id', id).single())
}

export async function listTrash(coupleId: string): Promise<Media[]> {
  return unwrapList(
    await supabase
      .from('media')
      .select('*')
      .eq('couple_id', coupleId)
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false }),
  )
}

/** Existing fingerprints, for the duplicate prompt. Two columns, not whole rows. */
export async function listPhashes(coupleId: string): Promise<Media[]> {
  return unwrapList(
    await supabase
      .from('media')
      .select('*')
      .eq('couple_id', coupleId)
      .is('deleted_at', null)
      .not('phash', 'is', null)
      .order('uploaded_at', { ascending: false })
      .limit(2000),
  )
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export interface UploadInput {
  display: Blob
  thumb: Blob
  /**
   * What the display object actually is.
   *
   * A photo's display variant is a re-encoded JPEG. A video's *is the video* —
   * there is no browser-side transcode worth doing, so the file is stored as
   * uploaded and the thumb slot holds a poster frame. Hard-coding image/jpeg
   * here would serve an mp4 with the wrong Content-Type and browsers would
   * refuse to play it.
   */
  displayContentType?: string
  meta: Omit<InsertDto<'media'>, 'couple_id' | 'uploader_id' | 'path_display' | 'path_thumb' | 'id'>
}

/**
 * Two objects and a row, in that order.
 *
 * The row is written last because a row pointing at a file that failed to
 * upload is a broken thumbnail forever, while an object with no row is one
 * orphan the sweep can be taught about. If the insert fails, the objects are
 * removed — no orphans in either direction.
 *
 * **The original is never part of this.** `path_original` stays null.
 */
export async function uploadMedia(
  coupleId: string,
  uploaderId: string,
  input: UploadInput,
): Promise<Media> {
  // Minted client-side so both paths are known before either upload starts.
  const mediaId = crypto.randomUUID()
  const displayPath = mediaPath(
    coupleId,
    mediaId,
    'display',
    extensionFor(input.displayContentType),
  )
  const thumbPath = mediaPath(coupleId, mediaId, 'thumb')

  const options = {
    // Content-addressed paths never change, so the variant can be cached for
    // a year. This is most of the egress discipline in spec 11.4.
    cacheControl: '31536000',
    upsert: false,
  }

  const display = await supabase.storage.from(BUCKET).upload(displayPath, input.display, {
    ...options,
    contentType: input.displayContentType ?? 'image/jpeg',
  })
  if (display.error) throw toAppError(display.error)

  // The poster frame is always a JPEG, even for a video.
  const thumb = await supabase.storage
    .from(BUCKET)
    .upload(thumbPath, input.thumb, { ...options, contentType: 'image/jpeg' })
  if (thumb.error) {
    await supabase.storage.from(BUCKET).remove([displayPath])
    throw toAppError(thumb.error)
  }

  const { data, error } = await supabase
    .from('media')
    .insert({
      ...input.meta,
      id: mediaId,
      couple_id: coupleId,
      uploader_id: uploaderId,
      path_display: displayPath,
      path_thumb: thumbPath,
      path_original: null,
      bytes: input.display.size + input.thumb.size,
    })
    .select('*')
    .single()

  if (error) {
    await supabase.storage.from(BUCKET).remove([displayPath, thumbPath])
    throw toAppError(error)
  }

  return data
}

/**
 * A signed URL for one variant.
 *
 * The grid asks for thumbs and the lightbox asks for displays, and nothing
 * asks for both — that separation is what keeps a sixty-item page under three
 * megabytes.
 */
export async function getMediaUrl(media: Media, variant: MediaVariant): Promise<string> {
  const path = variant === 'thumb' ? media.path_thumb : media.path_display
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
  if (error || !data) throw toAppError(error ?? new Error('Could not sign that URL.'))
  return data.signedUrl
}

/** One round trip for a whole page of thumbnails. */
export async function getMediaUrls(
  media: readonly Media[],
  variant: MediaVariant,
): Promise<Record<string, string>> {
  if (media.length === 0) return {}

  const paths = media.map((m) => (variant === 'thumb' ? m.path_thumb : m.path_display))
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS)
  if (error || !data) throw toAppError(error ?? new Error('Could not sign those URLs.'))

  const urls: Record<string, string> = {}
  data.forEach((entry, index) => {
    const item = media[index]
    if (item && entry.signedUrl) urls[item.id] = entry.signedUrl
  })
  return urls
}

export async function updateMedia(id: string, patch: UpdateDto<'media'>): Promise<Media> {
  return unwrap(await supabase.from('media').update(patch).eq('id', id).select('*').single())
}

/** Soft delete. The objects stay for thirty days; the sweep removes both. */
export async function deleteMedia(ids: readonly string[]): Promise<void> {
  const { error } = await supabase
    .from('media')
    .update({ deleted_at: new Date().toISOString() })
    .in('id', [...ids])
  if (error) throw toAppError(error)
}

export async function restoreMedia(ids: readonly string[]): Promise<void> {
  const { error } = await supabase.from('media').update({ deleted_at: null }).in('id', [...ids])
  if (error) throw toAppError(error)
}

export async function getUsage(): Promise<MediaUsage> {
  const { data, error } = await supabase.rpc('media_usage').single()
  if (error) throw toAppError(error)
  return {
    photoCount: Number(data?.photo_count ?? 0),
    totalBytes: Number(data?.total_bytes ?? 0),
    trashedCount: Number(data?.trashed_count ?? 0),
  }
}

// ---------------------------------------------------------------------------
// Albums
// ---------------------------------------------------------------------------

export async function listAlbums(coupleId: string): Promise<Album[]> {
  return unwrapList(
    await supabase
      .from('albums')
      .select('*')
      .eq('couple_id', coupleId)
      .order('sort_order')
      .order('created_at', { ascending: false }),
  )
}

export async function createAlbum(
  coupleId: string,
  userId: string,
  title: string,
): Promise<Album> {
  return unwrap(
    await supabase
      .from('albums')
      .insert({ couple_id: coupleId, title, kind: 'manual', created_by: userId })
      .select('*')
      .single(),
  )
}

export async function ensureTripAlbum(tripId: string): Promise<string> {
  const { data, error } = await supabase.rpc('ensure_trip_album', { target_trip: tripId })
  if (error) throw toAppError(error)
  return data
}

export async function addToAlbum(albumId: string, mediaIds: readonly string[]): Promise<void> {
  if (mediaIds.length === 0) return
  const { error } = await supabase
    .from('album_media')
    .upsert(
      mediaIds.map((mediaId, index) => ({
        album_id: albumId,
        media_id: mediaId,
        sort_key: String(Date.now() + index),
      })),
      { onConflict: 'album_id,media_id' },
    )
  if (error) throw toAppError(error)
}

export async function removeFromAlbum(albumId: string, mediaIds: readonly string[]): Promise<void> {
  const { error } = await supabase
    .from('album_media')
    .delete()
    .eq('album_id', albumId)
    .in('media_id', [...mediaIds])
  if (error) throw toAppError(error)
}

export async function setAlbumCover(albumId: string, mediaId: string | null): Promise<Album> {
  return unwrap(
    await supabase
      .from('albums')
      .update({ cover_media_id: mediaId })
      .eq('id', albumId)
      .select('*')
      .single(),
  )
}

export async function deleteAlbum(id: string): Promise<void> {
  const { error } = await supabase.from('albums').delete().eq('id', id)
  if (error) throw toAppError(error)
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export async function listComments(mediaId: string): Promise<MediaComment[]> {
  return unwrapList(
    await supabase
      .from('media_comments')
      .select('*')
      .eq('media_id', mediaId)
      .order('created_at'),
  )
}

export async function addComment(
  mediaId: string,
  authorId: string,
  body: string,
): Promise<MediaComment> {
  return unwrap(
    await supabase
      .from('media_comments')
      .insert({ media_id: mediaId, author_id: authorId, body })
      .select('*')
      .single(),
  )
}

export async function deleteComment(id: string): Promise<void> {
  const { error } = await supabase.from('media_comments').delete().eq('id', id)
  if (error) throw toAppError(error)
}

// ---------------------------------------------------------------------------
// Sharing
// ---------------------------------------------------------------------------

/**
 * 32 bytes of CSPRNG, base64url. Spec 11.4.
 *
 * The token is the whole security boundary for a share, so it comes from
 * `crypto.getRandomValues` and nothing else — not a uuid, not a timestamp, not
 * `Math.random`.
 */
export function generateShareToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** SHA-256 of the passcode. The plaintext never leaves the browser. */
async function hashPasscode(passcode: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(passcode))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function createShareLink(
  coupleId: string,
  userId: string,
  target: { type: 'media' | 'album'; id: string },
  options: ShareOptions,
): Promise<ShareLink> {
  const expiresAt = new Date(Date.now() + options.expiresInDays * 86_400_000).toISOString()

  return unwrap(
    await supabase
      .from('share_links')
      .insert({
        couple_id: coupleId,
        created_by: userId,
        token: generateShareToken(),
        target_type: target.type,
        target_id: target.id,
        allow_download: options.allowDownload,
        passcode_hash: options.passcode ? await hashPasscode(options.passcode) : null,
        expires_at: expiresAt,
      })
      .select('*')
      .single(),
  )
}

export async function listShareLinks(coupleId: string): Promise<ShareLink[]> {
  return unwrapList(
    await supabase
      .from('share_links')
      .select('*')
      .eq('couple_id', coupleId)
      .is('revoked_at', null)
      .order('created_at', { ascending: false }),
  )
}

/** Revocation is immediate: the next resolve fails, whoever holds the link. */
export async function revokeShareLink(id: string): Promise<void> {
  const { error } = await supabase
    .from('share_links')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw toAppError(error)
}

// ---------------------------------------------------------------------------
// Daily exchange
// ---------------------------------------------------------------------------

export async function listExchange(coupleId: string, since: string) {
  return unwrapList(
    await supabase
      .from('daily_exchange')
      .select('*')
      .eq('couple_id', coupleId)
      .gte('exchange_date', since)
      .order('exchange_date', { ascending: false }),
  )
}

export async function postExchange(
  coupleId: string,
  userId: string,
  mediaId: string,
  exchangeDate: string,
): Promise<void> {
  // Changing your mind about today's photo replaces it rather than failing on
  // the unique key.
  const { error } = await supabase
    .from('daily_exchange')
    .upsert(
      { couple_id: coupleId, user_id: userId, media_id: mediaId, exchange_date: exchangeDate },
      { onConflict: 'couple_id,user_id,exchange_date' },
    )
  if (error) throw toAppError(error)
}
