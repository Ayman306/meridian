/**
 * couple_id + both profiles, app-wide. Almost every query needs it, so it is
 * fetched once here rather than per module.
 *
 * Solo mode (signed in, not yet paired) is a first-class state, not an error:
 * a partner may join days later. See spec 1.4.
 */
'use client'

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useQueries } from '@tanstack/react-query'
import { qk } from '@/lib/queryClient'
import { useAuth } from '@/providers/AuthProvider'
import * as authApi from '@/modules/auth/api'
import { toPersonRef } from '@/modules/auth/logic'
import type { CoupleContextValue, PersonRef } from '@/types/domain'

interface FullCoupleContext extends CoupleContextValue {
  coupleId: string | null
  selfRef: PersonRef | null
  partnerRef: PersonRef | null
  /** Both timezones, defaulting sensibly when there is no partner yet. */
  tzSelf: string
  tzPartner: string
}

const CoupleContext = createContext<FullCoupleContext | null>(null)

export function CoupleProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const userId = user?.id ?? null

  const [coupleQ, selfQ, partnerQ] = useQueries({
    queries: [
      {
        queryKey: qk.couple,
        queryFn: authApi.getCouple,
        enabled: Boolean(userId),
      },
      {
        queryKey: qk.profile(userId ?? 'anon'),
        queryFn: () => authApi.getProfile(userId!),
        enabled: Boolean(userId),
      },
      {
        queryKey: qk.partner,
        queryFn: authApi.getPartner,
        enabled: Boolean(userId),
      },
    ],
  })

  const value = useMemo<FullCoupleContext>(() => {
    const couple = coupleQ.data ?? null
    const self = selfQ.data ?? null
    const partner = partnerQ.data ?? null
    const isLoading = coupleQ.isLoading || selfQ.isLoading || partnerQ.isLoading

    return {
      couple,
      coupleId: couple?.id ?? null,
      self,
      partner,
      selfRef: toPersonRef(self, userId),
      partnerRef: toPersonRef(partner, userId),
      tzSelf: self?.timezone ?? 'UTC',
      tzPartner: partner?.timezone ?? self?.timezone ?? 'UTC',
      isSolo: !isLoading && couple === null,
      // Paired, but the other member's profile is gone — they deleted their
      // account. The app must stay usable; shared data survives.
      isOrphaned: !isLoading && couple !== null && partner === null,
      isLoading,
      error: coupleQ.error ?? selfQ.error ?? partnerQ.error,
      refetch: async () => {
        await Promise.all([coupleQ.refetch(), selfQ.refetch(), partnerQ.refetch()])
      },
    }
  }, [coupleQ, selfQ, partnerQ, userId])

  return <CoupleContext.Provider value={value}>{children}</CoupleContext.Provider>
}

export function useCouple() {
  const ctx = useContext(CoupleContext)
  if (!ctx) throw new Error('useCouple must be used inside CoupleProvider')
  return ctx
}

/** For modules that cannot function without a couple. Throws in solo mode. */
export function useCoupleId(): string {
  const { coupleId } = useCouple()
  if (!coupleId) throw new Error('No couple in context — this screen must be gated on pairing')
  return coupleId
}
