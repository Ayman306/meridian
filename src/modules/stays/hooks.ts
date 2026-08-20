'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { qk } from '@/lib/queryClient'
import { useAuth } from '@/providers/AuthProvider'
import { useCouple } from '@/providers/CoupleProvider'
import type { UpdateDto } from '@/types/database'
import { useCoupleRealtime } from '@/lib/realtime'
import * as api from './api'

export function useStays(tripId: string | undefined) {
  return useQuery({
    queryKey: qk.stays(tripId ?? 'none'),
    queryFn: () => api.listStays(tripId!),
    enabled: Boolean(tripId),
  })
}

/**
 * A stay changes what the journey draws, so both caches are refreshed.
 *
 * The trip query is not obviously involved — but the journey screen reads the
 * trip and the stays together, and leaving one stale shows a bed on a day the
 * booking no longer covers.
 */
function invalidate(qc: ReturnType<typeof useQueryClient>, tripId: string) {
  void qc.invalidateQueries({ queryKey: qk.stays(tripId) })
  void qc.invalidateQueries({ queryKey: qk.trip(tripId) })
}

export function useAddStay(tripId: string) {
  const qc = useQueryClient()
  const { coupleId } = useCouple()
  const { user } = useAuth()

  return useMutation({
    mutationFn: (input: api.StayInput) => api.addStay(coupleId!, tripId, user!.id, input),
    onSuccess: () => invalidate(qc, tripId),
  })
}

export function useUpdateStay(tripId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateDto<'accommodations'> }) =>
      api.updateStay(id, patch),
    onSuccess: () => invalidate(qc, tripId),
  })
}

/**
 * Both of you see a booking the moment either of you saves it.
 *
 * The case this exists for: one of you books the hotel while the other is
 * looking at the journey. Without it, their day strip keeps showing that night
 * as unbooked — and "nights with nowhere booked" keeps counting a night that is
 * now booked, which is worse than showing nothing, because it is a number they
 * will act on.
 */
export function useStaysRealtime(tripId: string | undefined) {
  const qc = useQueryClient()
  const { coupleId } = useCouple()

  useCoupleRealtime('stays', coupleId, [{ table: 'accommodations', filterColumn: 'couple_id' }], () => {
    void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'stays' })
    if (tripId) void qc.invalidateQueries({ queryKey: qk.trip(tripId) })
  })
}

export function useRemoveStay(tripId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.removeStay(id),
    onSuccess: () => invalidate(qc, tripId),
  })
}
