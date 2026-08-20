'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/providers/AuthProvider'
import { useCouple } from '@/providers/CoupleProvider'
import { useCoupleRealtime } from '@/lib/realtime'
import { useUserSettings } from '@/modules/settings'
import * as api from './api'
import type { ActivityEvent } from './types'

/**
 * The feed, over a window wider than "unread".
 *
 * Deliberately not `since = activity_seen_at`. Marking it read would then empty
 * the list, and a card that goes blank the moment you look at it is a card that
 * teaches you not to look. It fetches a fortnight and the component bolds what
 * is new.
 */
export function useActivity(limit = 50) {
  const { coupleId } = useCouple()
  const qc = useQueryClient()

  const query = useQuery({
    queryKey: ['activity', coupleId ?? 'none'] as const,
    queryFn: () => api.listActivity(null, limit),
    enabled: Boolean(coupleId),
    // The morning read is the point; a stale feed for a minute is fine.
    staleTime: 60_000,
  })

  // The whole feed is derived from tables that now broadcast (0026), so it can
  // update while somebody is looking at it rather than only on reload.
  useCoupleRealtime(
    'activity',
    coupleId,
    [
      { table: 'itinerary_items', filterColumn: 'couple_id' },
      { table: 'wishlist_items', filterColumn: 'couple_id' },
      { table: 'accommodations', filterColumn: 'couple_id' },
      { table: 'expenses', filterColumn: 'couple_id' },
      { table: 'media', filterColumn: 'couple_id' },
    ],
    () => void qc.invalidateQueries({ queryKey: ['activity'] }),
  )

  return query
}

/** Where this person's "new" line sits. */
export function useActivitySeenAt(): string | null {
  const settings = useUserSettings()
  return settings.data?.activity_seen_at ?? null
}

export function useMarkActivitySeen() {
  const qc = useQueryClient()
  const { user } = useAuth()
  return useMutation({
    mutationFn: () => api.markActivitySeen(user!.id),
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'user-settings' }),
  })
}

// ---------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------

export function useIntegrations() {
  const { coupleId } = useCouple()
  return useQuery({
    queryKey: ['integrations', coupleId ?? 'none'] as const,
    queryFn: () => api.listIntegrations(coupleId!),
    enabled: Boolean(coupleId),
  })
}

function invalidateIntegrations(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ['integrations'] })
}

export function useAddIntegration() {
  const qc = useQueryClient()
  const { coupleId } = useCouple()
  const { user } = useAuth()
  return useMutation({
    mutationFn: (input: { name: string; url: string; events: ActivityEvent[] }) =>
      api.addIntegration(coupleId!, user!.id, input),
    onSuccess: () => invalidateIntegrations(qc),
  })
}

export function useSetIntegrationEnabled() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.setIntegrationEnabled(id, enabled),
    onSuccess: () => invalidateIntegrations(qc),
  })
}

export function useRemoveIntegration() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.removeIntegration(id),
    onSuccess: () => invalidateIntegrations(qc),
  })
}
