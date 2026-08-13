'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { qk } from '@/lib/queryClient'
import { useAuth } from '@/providers/AuthProvider'
import * as api from '@/modules/auth/api'
import type { UpdateDto } from '@/types/database'

export function useCreateCouple() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name?: string) => api.createCouple(name),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: qk.couple })
      await qc.invalidateQueries({ queryKey: qk.partner })
    },
  })
}

export function useJoinCouple() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (code: string) => api.joinCouple(code),
    onSuccess: async () => {
      // Everything the user can see changes the moment they pair.
      await qc.invalidateQueries()
    },
  })
}

export function useRegenerateInviteCode() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.regenerateInviteCode,
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.couple }),
  })
}

export function useLeaveCouple() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.leaveCouple,
    onSuccess: () => qc.clear(),
  })
}

export function useUpdateProfile() {
  const qc = useQueryClient()
  const { user } = useAuth()
  return useMutation({
    mutationFn: (patch: UpdateDto<'profiles'>) => {
      if (!user) throw new Error('Not signed in')
      return api.updateProfile(user.id, patch)
    },
    onSuccess: (profile) => {
      qc.setQueryData(qk.profile(profile.id), profile)
      void qc.invalidateQueries({ queryKey: qk.dashboard })
    },
  })
}

export function useUpdateCouple() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      coupleId,
      patch,
    }: {
      coupleId: string
      patch: { name?: string | null; anniversary_date?: string | null }
    }) => api.updateCouple(coupleId, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.couple }),
  })
}
