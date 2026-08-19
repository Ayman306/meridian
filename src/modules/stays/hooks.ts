'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { qk } from '@/lib/queryClient'
import { useAuth } from '@/providers/AuthProvider'
import { useCouple } from '@/providers/CoupleProvider'
import type { UpdateDto } from '@/types/database'
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

export function useRemoveStay(tripId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.removeStay(id),
    onSuccess: () => invalidate(qc, tripId),
  })
}
