'use client'

import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { qk } from '@/lib/queryClient'
import { supabase } from '@/lib/supabase/client'
import { useAuth } from '@/providers/AuthProvider'
import { useCouple } from '@/providers/CoupleProvider'
import type { UpdateDto } from '@/types/database'
import * as api from './api'
import type { Draft, Verdict } from './types'

export function useWishlist() {
  const { coupleId } = useCouple()
  return useQuery({
    queryKey: qk.wishlist(coupleId ?? 'none'),
    queryFn: () => api.listWishlist(coupleId!),
    enabled: Boolean(coupleId),
  })
}

export function useAddWishlistItem() {
  const qc = useQueryClient()
  const { coupleId } = useCouple()
  const { user } = useAuth()

  return useMutation({
    mutationFn: (input: api.WishlistInput) => api.addWishlistItem(coupleId!, user!.id, input),
    onSuccess: () => invalidate(qc),
  })
}

export function useUpdateWishlistItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateDto<'wishlist_items'> }) =>
      api.updateWishlistItem(id, patch),
    onSuccess: () => invalidate(qc),
  })
}

export function useDeleteWishlistItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteWishlistItem(id),
    onSuccess: () => invalidate(qc),
  })
}

/**
 * Casting a verdict, optimistically.
 *
 * Spec 7.2: changing your mind is one click with no confirmation. A click that
 * waits for a round trip before showing anything does not feel like one click,
 * so the button state flips first and reconciles after.
 */
export function useSetVerdict() {
  const qc = useQueryClient()
  const { coupleId } = useCouple()
  const { user } = useAuth()
  const key = qk.wishlist(coupleId ?? 'none')

  return useMutation({
    mutationFn: ({ id, verdict }: { id: string; verdict: Verdict | null }) =>
      verdict === null ? api.clearVerdict(id, user!.id) : api.setVerdict(id, user!.id, verdict),

    onMutate: async ({ id, verdict }) => {
      await qc.cancelQueries({ queryKey: key })
      const previous = qc.getQueryData<Awaited<ReturnType<typeof api.listWishlist>>>(key)
      const userId = user?.id
      if (previous && userId) {
        qc.setQueryData(
          key,
          previous.map((item) =>
            item.id !== id
              ? item
              : {
                  ...item,
                  verdicts: [
                    ...item.verdicts.filter((v) => v.user_id !== userId),
                    ...(verdict === null
                      ? []
                      : [
                          {
                            wishlist_id: id,
                            user_id: userId,
                            verdict,
                            created_at: new Date().toISOString(),
                            updated_at: new Date().toISOString(),
                          },
                        ]),
                  ],
                },
          ),
        )
      }
      return { previous }
    },

    onError: (_e, _vars, context) => {
      if (context?.previous) qc.setQueryData(key, context.previous)
    },

    onSettled: () => invalidate(qc),
  })
}

export function usePushToItinerary(tripId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (itemIds: string[]) => api.pushToItinerary(itemIds, tripId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.itinerary(tripId) })
      void qc.invalidateQueries({ queryKey: qk.trip(tripId) })
    },
  })
}

/** Generation is a button, never automatic, and its output lands in the tray. */
export function useSaveDraft(tripId: string) {
  const qc = useQueryClient()
  const { coupleId } = useCouple()
  return useMutation({
    mutationFn: ({ draft, pace }: { draft: Draft; pace: string }) =>
      api.saveDraftToTray(coupleId!, tripId, draft, pace),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.tray(tripId) }),
  })
}

export function useExtractFromUrl() {
  return useMutation({ mutationFn: (url: string) => api.extractFromUrl(url) })
}

/**
 * Spec 7.7: a verdict change shows on the partner's screen within 2 seconds.
 * Saves themselves sync too — one of them adding a place while the other is
 * looking at the blend is the normal case.
 */
export function useWishlistRealtime() {
  const qc = useQueryClient()
  const { coupleId } = useCouple()

  useEffect(() => {
    if (!coupleId) return

    const refresh = () => void qc.invalidateQueries({ queryKey: qk.wishlist(coupleId) })
    const channel = supabase
      .channel(`wishlist:${coupleId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'wishlist_items',
          filter: `couple_id=eq.${coupleId}`,
        },
        refresh,
      )
      // Verdicts carry no couple_id — the filter would have nothing to match
      // on, and RLS already limits what arrives to this couple's rows.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wishlist_verdicts' }, refresh)
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [coupleId, qc])
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'wishlist' })
}
