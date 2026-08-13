import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { qk } from '@/lib/queryClient'
import { supabase } from '@/lib/supabase'
import { useCouple } from '@/providers/CoupleProvider'
import type { DateOnly } from '@/lib/dates'
import * as api from './api'
import type { ItineraryItem } from './types'
import type { UpdateDto } from '@/types/database'

export function useCategories() {
  const { coupleId } = useCouple()
  return useQuery({
    queryKey: qk.categories,
    queryFn: () => api.listCategories(coupleId!),
    enabled: Boolean(coupleId),
    staleTime: 10 * 60_000,
  })
}

export function useItems(tripId: string | undefined) {
  return useQuery({
    queryKey: qk.itinerary(tripId ?? 'none'),
    queryFn: () => api.listItems(tripId!),
    enabled: Boolean(tripId),
  })
}

export function useCreateItem(tripId: string) {
  const qc = useQueryClient()
  const { coupleId, self } = useCouple()
  return useMutation({
    mutationFn: (input: Omit<api.CreateItemInput, 'couple_id' | 'trip_id'>) =>
      api.createItem({
        ...input,
        couple_id: coupleId!,
        trip_id: tripId,
        // Whose pick, defaulting to whoever is adding it.
        proposed_by: input.proposed_by ?? self?.id ?? null,
      }),
    onSuccess: () => invalidatePlan(qc, tripId),
  })
}

export function useUpdateItem(tripId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateDto<'itinerary_items'> }) =>
      api.updateItem(id, patch),
    onSuccess: () => invalidatePlan(qc, tripId),
  })
}

/**
 * Drag and drop. Optimistic, because a drag that visibly snaps back while the
 * server thinks about it feels broken even when it succeeds.
 */
export function useMoveItem(tripId: string) {
  const qc = useQueryClient()
  const key = qk.itinerary(tripId)

  return useMutation({
    mutationFn: ({
      id,
      date,
      beforeKey,
      afterKey,
    }: {
      id: string
      date: DateOnly | null
      beforeKey: string | null
      afterKey: string | null
    }) => api.moveItem(id, date, beforeKey, afterKey),

    onMutate: async ({ id, date }) => {
      await qc.cancelQueries({ queryKey: key })
      const previous = qc.getQueryData<ItineraryItem[]>(key)
      qc.setQueryData<ItineraryItem[]>(key, (items) =>
        items?.map((i) =>
          i.id === id
            ? {
                ...i,
                scheduled_date: date,
                ...(date === null ? { start_time: null, end_time: null } : {}),
              }
            : i,
        ),
      )
      return { previous }
    },

    onError: (_e, _vars, context) => {
      if (context?.previous) qc.setQueryData(key, context.previous)
    },

    onSettled: () => invalidatePlan(qc, tripId),
  })
}

export function useBulkMove(tripId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ ids, date }: { ids: string[]; date: DateOnly | null }) =>
      api.bulkMove(ids, date),
    onSuccess: () => invalidatePlan(qc, tripId),
  })
}

export function useDeleteItem(tripId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteItem(id),
    onSuccess: () => invalidatePlan(qc, tripId),
  })
}

export function useRestoreItem(tripId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.restoreItem(id),
    onSuccess: () => invalidatePlan(qc, tripId),
  })
}

export function useSuggestionTray(tripId: string | undefined) {
  return useQuery({
    queryKey: qk.tray(tripId ?? 'none'),
    queryFn: () => api.listTray(tripId!),
    enabled: Boolean(tripId),
  })
}

export function useDismissSuggestion(tripId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.dismissSuggestion(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.tray(tripId) }),
  })
}

function invalidatePlan(qc: ReturnType<typeof useQueryClient>, tripId: string) {
  void qc.invalidateQueries({ queryKey: qk.itinerary(tripId) })
  // Adding an item can promote a day from open to planned.
  void qc.invalidateQueries({ queryKey: qk.trip(tripId) })
}

/**
 * Two people dragging the same plan is the normal case, not an edge case.
 * Last write wins; the loser's view corrects itself on the next event.
 */
export function useItineraryRealtime(tripId: string | undefined) {
  const qc = useQueryClient()

  useEffect(() => {
    if (!tripId) return

    const channel = supabase
      .channel(`itinerary:${tripId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'itinerary_items',
          filter: `trip_id=eq.${tripId}`,
        },
        () => void qc.invalidateQueries({ queryKey: qk.itinerary(tripId) }),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'suggestion_tray',
          filter: `trip_id=eq.${tripId}`,
        },
        () => void qc.invalidateQueries({ queryKey: qk.tray(tripId) }),
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [tripId, qc])
}
