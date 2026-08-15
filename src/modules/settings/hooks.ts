'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { qk } from '@/lib/queryClient'
import { useAuth } from '@/providers/AuthProvider'
import { useCouple } from '@/providers/CoupleProvider'
import type { UpdateDto } from '@/types/database'
import * as api from './api'
import type { AccessTokenInput, InviteInput, MemberRole, ModuleName } from './types'

export function useCoupleSettings() {
  const { coupleId } = useCouple()
  return useQuery({
    queryKey: qk.coupleSettings(coupleId ?? 'none'),
    queryFn: () => api.getCoupleSettings(coupleId!),
    enabled: Boolean(coupleId),
  })
}

export function useUserSettings() {
  const { user } = useAuth()
  return useQuery({
    queryKey: qk.userSettings(user?.id ?? 'anon'),
    queryFn: () => api.getUserSettings(user!.id),
    enabled: Boolean(user?.id),
  })
}

export function useUpdateCoupleSettings() {
  const qc = useQueryClient()
  const { coupleId } = useCouple()
  return useMutation({
    mutationFn: (patch: UpdateDto<'couple_settings'>) =>
      api.updateCoupleSettings(coupleId!, patch),
    onSuccess: () => {
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'couple-settings' })
      // The base currency lives here now; everything money-shaped reads it.
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'expenses' })
    },
  })
}

export function useUpdateUserSettings() {
  const qc = useQueryClient()
  const { user } = useAuth()
  return useMutation({
    mutationFn: (patch: UpdateDto<'user_settings'>) => api.updateUserSettings(user!.id, patch),
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'user-settings' }),
  })
}

export function useMembers() {
  const { coupleId } = useCouple()
  return useQuery({
    queryKey: qk.members(coupleId ?? 'none'),
    queryFn: () => api.listMembers(coupleId!),
    enabled: Boolean(coupleId),
  })
}

export function useInvites() {
  const { coupleId } = useCouple()
  return useQuery({
    queryKey: qk.invites(coupleId ?? 'none'),
    queryFn: () => api.listInvites(coupleId!),
    enabled: Boolean(coupleId),
  })
}

export function useCreateInvite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: InviteInput) => api.createInvite(input),
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'invites' }),
  })
}

export function useRevokeInvite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.revokeInvite,
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'invites' }),
  })
}

export function useSetMemberGrants() {
  const qc = useQueryClient()
  const { coupleId } = useCouple()
  return useMutation({
    mutationFn: ({ userId, grants }: { userId: string; grants: ModuleName[] | null }) =>
      api.setMemberGrants(coupleId!, userId, grants),
    onSuccess: () => {
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'members' })
      // Changing somebody's grants changes what they may read, so anything
      // already cached under the old rules has to go.
      void qc.invalidateQueries({ queryKey: qk.myModules })
    },
  })
}

export function useRemoveMember() {
  const qc = useQueryClient()
  const { coupleId } = useCouple()
  return useMutation({
    mutationFn: (userId: string) => api.removeMember(coupleId!, userId),
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'members' }),
  })
}

export function useAcceptInvite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.acceptInvite,
    onSuccess: () => qc.clear(),
  })
}

/** The caller's own role and grants, straight from the database. */
export function useMyAccess(): {
  role: MemberRole | null
  modules: ModuleName[]
  isLoading: boolean
} {
  const { coupleId } = useCouple()
  const modules = useQuery({
    queryKey: qk.myModules,
    queryFn: api.getMyModules,
    enabled: Boolean(coupleId),
    staleTime: 60_000,
  })
  const role = useQuery({
    queryKey: ['my-role'] as const,
    queryFn: api.getMyRole,
    enabled: Boolean(coupleId),
    staleTime: 60_000,
  })
  return {
    role: role.data ?? null,
    modules: modules.data ?? [],
    isLoading: modules.isLoading || role.isLoading,
  }
}

export function useAccessTokens() {
  const { user } = useAuth()
  return useQuery({
    queryKey: qk.accessTokens(user?.id ?? 'anon'),
    queryFn: api.listAccessTokens,
    enabled: Boolean(user?.id),
  })
}

/**
 * Minting returns the raw token, so this mutation's `data` is the only place it
 * ever exists. The component holds it in state and shows it once; nothing is
 * cached, and the query it invalidates deliberately cannot see it.
 */
export function useCreateAccessToken() {
  const qc = useQueryClient()
  const { user } = useAuth()
  return useMutation({
    mutationFn: (input: AccessTokenInput) => api.createAccessToken(input, user!.id),
    onSuccess: () => {
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'access-tokens' })
    },
  })
}

export function useRevokeAccessToken() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.revokeAccessToken(id),
    onSuccess: () => {
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'access-tokens' })
    },
  })
}
