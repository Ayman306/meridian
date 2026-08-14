'use client'

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { qk } from '@/lib/queryClient'
import { supabase } from '@/lib/supabase/client'
import { useAuth } from '@/providers/AuthProvider'
import { useCouple } from '@/providers/CoupleProvider'
import { processImage, isVideo, MAX_VIDEO_BYTES } from '@/lib/images'
import { userMessage } from '@/lib/errors'
import type { UpdateDto } from '@/types/database'
import * as api from './api'
import { findDuplicate } from './logic'
import {
  EMPTY_QUEUE,
  backoffMs,
  loadQueue,
  nextPending,
  reduce,
  saveQueue,
  shouldRetry,
  summarise,
} from './queue'
import type { Media, MediaFilters, MediaVariant, ShareOptions } from './types'

export function useMediaPages(filters: MediaFilters = {}) {
  const { coupleId } = useCouple()
  return useInfiniteQuery({
    queryKey: qk.media(coupleId ?? 'none', JSON.stringify(filters)),
    queryFn: ({ pageParam }) => api.listMedia(coupleId!, filters, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.cursor,
    enabled: Boolean(coupleId),
  })
}

export function useMedia(id: string | undefined) {
  return useQuery({
    queryKey: qk.mediaItem(id ?? 'none'),
    queryFn: () => api.getMedia(id!),
    enabled: Boolean(id),
  })
}

export function useTrash() {
  const { coupleId } = useCouple()
  return useQuery({
    queryKey: qk.mediaTrash(coupleId ?? 'none'),
    queryFn: () => api.listTrash(coupleId!),
    enabled: Boolean(coupleId),
  })
}

/**
 * Signed URLs for a page of media, one round trip.
 *
 * Cached for slightly less than the URL's own lifetime so scrolling back does
 * not re-sign, and `refetchOnWindowFocus` off because a signed URL does not go
 * stale when you switch tabs.
 */
export function useMediaUrls(media: readonly Media[], variant: MediaVariant) {
  const key = media.map((m) => m.id).join(',')
  return useQuery({
    queryKey: ['media-urls', variant, key] as const,
    queryFn: () => api.getMediaUrls(media, variant),
    enabled: media.length > 0,
    staleTime: 50 * 60_000,
    refetchOnWindowFocus: false,
  })
}

export function useMediaUrl(media: Media | undefined, variant: MediaVariant) {
  return useQuery({
    queryKey: ['media-url', variant, media?.id ?? 'none'] as const,
    queryFn: () => api.getMediaUrl(media!, variant),
    enabled: Boolean(media),
    staleTime: 50 * 60_000,
    refetchOnWindowFocus: false,
  })
}

export function useUpdateMedia() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateDto<'media'> }) =>
      api.updateMedia(id, patch),
    onSuccess: (media) => {
      void qc.invalidateQueries({ queryKey: qk.mediaItem(media.id) })
      invalidate(qc)
    },
  })
}

export function useDeleteMedia() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids: string[]) => api.deleteMedia(ids),
    onSuccess: () => invalidate(qc),
  })
}

export function useRestoreMedia() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids: string[]) => api.restoreMedia(ids),
    onSuccess: () => invalidate(qc),
  })
}

export function useUsage() {
  const { coupleId } = useCouple()
  return useQuery({
    queryKey: qk.mediaUsage,
    queryFn: api.getUsage,
    enabled: Boolean(coupleId),
    staleTime: 60_000,
  })
}

export function useAlbums() {
  const { coupleId } = useCouple()
  return useQuery({
    queryKey: qk.albums(coupleId ?? 'none'),
    queryFn: () => api.listAlbums(coupleId!),
    enabled: Boolean(coupleId),
  })
}

export function useAlbumMedia(albumId: string | undefined) {
  return useQuery({
    queryKey: ['album-media', albumId ?? 'none'] as const,
    queryFn: () => api.listAlbumMedia(albumId!),
    enabled: Boolean(albumId),
  })
}

export function useCreateAlbum() {
  const qc = useQueryClient()
  const { coupleId } = useCouple()
  const { user } = useAuth()
  return useMutation({
    mutationFn: (title: string) => api.createAlbum(coupleId!, user!.id, title),
    onSuccess: () => invalidate(qc),
  })
}

export function useAddToAlbum() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ albumId, mediaIds }: { albumId: string; mediaIds: string[] }) =>
      api.addToAlbum(albumId, mediaIds),
    onSuccess: () => invalidate(qc),
  })
}

export function useComments(mediaId: string | undefined) {
  return useQuery({
    queryKey: ['media-comments', mediaId ?? 'none'] as const,
    queryFn: () => api.listComments(mediaId!),
    enabled: Boolean(mediaId),
  })
}

export function useAddComment(mediaId: string) {
  const qc = useQueryClient()
  const { user } = useAuth()
  return useMutation({
    mutationFn: (body: string) => api.addComment(mediaId, user!.id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['media-comments', mediaId] }),
  })
}

export function useShareLinks() {
  const { coupleId } = useCouple()
  return useQuery({
    queryKey: qk.shareLinks(coupleId ?? 'none'),
    queryFn: () => api.listShareLinks(coupleId!),
    enabled: Boolean(coupleId),
  })
}

export function useCreateShare() {
  const qc = useQueryClient()
  const { coupleId } = useCouple()
  const { user } = useAuth()
  return useMutation({
    mutationFn: ({
      target,
      options,
    }: {
      target: { type: 'media' | 'album'; id: string }
      options: ShareOptions
    }) => api.createShareLink(coupleId!, user!.id, target, options),
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'share-links' }),
  })
}

export function useRevokeShare() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.revokeShareLink(id),
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'share-links' }),
  })
}

export function useExchange(since: string) {
  const { coupleId } = useCouple()
  return useQuery({
    queryKey: ['daily-exchange', coupleId ?? 'none', since] as const,
    queryFn: () => api.listExchange(coupleId!, since),
    enabled: Boolean(coupleId),
  })
}

export function usePostExchange() {
  const qc = useQueryClient()
  const { coupleId } = useCouple()
  const { user } = useAuth()
  return useMutation({
    mutationFn: ({ mediaId, exchangeDate }: { mediaId: string; exchangeDate: string }) =>
      api.postExchange(coupleId!, user!.id, mediaId, exchangeDate),
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'daily-exchange' }),
  })
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export interface UploadOptions {
  tripId?: string | null
  /** Skip the duplicate prompt for a file the user already said yes to. */
  force?: Set<string>
}

/**
 * The upload pipeline: process, check for a duplicate, upload, repeat.
 *
 * One at a time and driven by the reducer rather than a loop, because the
 * queue has to survive a refresh — the acceptance test is fifty photos with a
 * reload halfway through. Every transition writes to IndexedDB, and on reload
 * anything mid-flight comes back as pending with its file missing, which the
 * UI asks for again rather than pretending it can resume.
 */
export function useUploadQueue(options: UploadOptions = {}) {
  const { coupleId } = useCouple()
  const { user } = useAuth()
  const qc = useQueryClient()

  const [state, dispatch] = useReducer(reduce, EMPTY_QUEUE)
  const files = useRef(new Map<string, File>())
  const running = useRef(false)
  const [hydrated, setHydrated] = useState(false)

  // Whatever was in flight when the page went away.
  useEffect(() => {
    let cancelled = false
    void loadQueue().then((saved) => {
      if (!cancelled && saved && saved.items.length > 0) {
        dispatch({ type: 'hydrate', state: saved })
      }
      if (!cancelled) setHydrated(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (hydrated) void saveQueue(state)
  }, [state, hydrated])

  const add = useCallback((incoming: File[]) => {
    const entries = incoming.map((file) => {
      const id = crypto.randomUUID()
      files.current.set(id, file)
      return { id, name: file.name, bytes: file.size }
    })
    dispatch({ type: 'add', items: entries })
  }, [])

  const processOne = useCallback(
    async (itemId: string) => {
      const file = files.current.get(itemId)
      if (!file) {
        // A queue restored from IndexedDB has no File to work with.
        dispatch({
          type: 'status',
          id: itemId,
          status: 'failed',
          error: 'Pick this file again — it was lost when the page reloaded.',
        })
        return
      }

      dispatch({ type: 'attempt', id: itemId })
      dispatch({ type: 'status', id: itemId, status: 'processing' })

      try {
        if (isVideo(file)) {
          if (file.size > MAX_VIDEO_BYTES) throw new Error('That video is over the 200 MB cap.')
          throw new Error('Videos are not supported yet.')
        }

        const processed = await processImage(file)

        if (!options.force?.has(itemId)) {
          const existing = await api.listPhashes(coupleId!)
          const duplicate = findDuplicate(processed.phash, existing)
          if (duplicate) {
            // Prompt, never auto-reject (spec 11.3).
            dispatch({ type: 'duplicate', id: itemId, duplicateOf: duplicate.id })
            return
          }
        }

        dispatch({ type: 'status', id: itemId, status: 'uploading' })
        dispatch({ type: 'progress', id: itemId, progress: 0.3 })

        const media = await api.uploadMedia(coupleId!, user!.id, {
          display: processed.display,
          thumb: processed.thumb,
          meta: {
            trip_id: options.tripId ?? null,
            thumbhash: processed.thumbhash,
            phash: processed.phash,
            width: processed.width,
            height: processed.height,
            taken_at: processed.takenAt,
            lat: processed.lat,
            lng: processed.lng,
            mime_type: 'image/jpeg',
            media_type: 'photo',
          },
        })

        dispatch({ type: 'media', id: itemId, mediaId: media.id })
        dispatch({ type: 'status', id: itemId, status: 'done' })
        files.current.delete(itemId)
        invalidate(qc)
      } catch (e) {
        dispatch({ type: 'status', id: itemId, status: 'failed', error: userMessage(e) })
      }
    },
    [coupleId, user, options.tripId, options.force, qc],
  )

  // The pump. Picks up one item, and re-runs when the state settles.
  useEffect(() => {
    if (!hydrated || running.current || !coupleId || !user) return

    const next = nextPending(state)
    if (next) {
      running.current = true
      void processOne(next.id).finally(() => {
        running.current = false
      })
      return
    }

    // Nothing pending: schedule the first retryable failure, with backoff.
    const retryable = state.items.find(shouldRetry)
    if (!retryable || state.paused) return

    const timer = setTimeout(
      () => dispatch({ type: 'status', id: retryable.id, status: 'pending' }),
      backoffMs(retryable.attempts),
    )
    return () => clearTimeout(timer)
  }, [state, hydrated, coupleId, user, processOne])

  return {
    state,
    summary: useMemo(() => summarise(state), [state]),
    add,
    pause: useCallback(() => dispatch({ type: 'pause' }), []),
    resume: useCallback(() => dispatch({ type: 'resume' }), []),
    retry: useCallback((id: string) => dispatch({ type: 'retry', id }), []),
    remove: useCallback((id: string) => {
      files.current.delete(id)
      dispatch({ type: 'remove', id })
    }, []),
    clearFinished: useCallback(() => dispatch({ type: 'clearFinished' }), []),
    /** "Upload it anyway" on the duplicate prompt. */
    uploadAnyway: useCallback((id: string) => dispatch({ type: 'retry', id }), []),
  }
}

export type UploadQueue = ReturnType<typeof useUploadQueue>

/** Both partners' uploads land in one library; the other screen should show them. */
export function useGalleryRealtime(coupleId: string | null) {
  const qc = useQueryClient()

  useEffect(() => {
    if (!coupleId) return
    const channel = supabase
      .channel(`media:${coupleId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'media', filter: `couple_id=eq.${coupleId}` },
        () => invalidate(qc),
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [coupleId, qc])
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'media' })
  void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'media-trash' })
  void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'albums' })
  void qc.invalidateQueries({ queryKey: qk.mediaUsage })
}
