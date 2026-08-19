'use client'

import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { qk } from '@/lib/queryClient'
import { useAuth } from '@/providers/AuthProvider'
import { useCouple } from '@/providers/CoupleProvider'
import type { InsertDto, UpdateDto } from '@/types/database'
import * as api from './api'
import { MAX_PROJECTED_CYCLES, calendarMarks, predict, predictCycles } from './logic'
import type { DateOnly } from '@/lib/dates'
import type { ConsentScope, DayMark, Prediction, RecordKind } from './types'

/** The signed-in person's own id. Everything here is owner-scoped. */
function useOwnerId(): string | null {
  const { user } = useAuth()
  return user?.id ?? null
}

export function useConsents() {
  const ownerId = useOwnerId()
  return useQuery({
    queryKey: qk.healthConsents,
    queryFn: api.listConsents,
    enabled: Boolean(ownerId),
  })
}

export function useGrantConsent() {
  const qc = useQueryClient()
  const ownerId = useOwnerId()
  const { partner } = useCouple()
  return useMutation({
    mutationFn: (scope: ConsentScope) => api.grantConsent(ownerId!, partner!.id, scope),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.healthConsents }),
  })
}

export function useRevokeConsent() {
  const qc = useQueryClient()
  const ownerId = useOwnerId()
  const { partner } = useCouple()
  return useMutation({
    mutationFn: (scope: ConsentScope) => api.revokeConsent(ownerId!, partner!.id, scope),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.healthConsents }),
  })
}

/**
 * Cycle logs for one owner.
 *
 * `ownerId` is a parameter rather than always the signed-in user, because the
 * partner view reads the other person's — and gets nothing back unless the
 * consent row exists. The same hook serves both, which is deliberate: there is
 * no separate "partner" code path that could forget to be restricted.
 */
export function useCycles(ownerId: string | null) {
  return useQuery({
    queryKey: qk.cycles(ownerId ?? 'none'),
    queryFn: () => api.listCycles(ownerId!),
    enabled: Boolean(ownerId),
  })
}

export function usePrediction(ownerId: string | null): Prediction {
  const cycles = useCycles(ownerId)
  return useMemo(() => predict(cycles.data ?? []), [cycles.data])
}

/**
 * What the cycle looks like across a date range — for the signed-in person and
 * nobody else.
 *
 * Deliberately not parameterised by owner, unlike `useCycles`. This exists so
 * the trip journey can mark days, and a trip is a shared screen: passing an
 * owner id would eventually be passed the partner's, and consent granted so a
 * person could look with their own eyes is not consent to have it drawn onto a
 * planning view they share. RLS would still refuse without consent; this makes
 * the refusal unnecessary by never asking.
 *
 * Returns an empty map rather than null when there is nothing logged, so a
 * caller can read it without branching.
 */
export function useCycleWindow(from: DateOnly | null, to: DateOnly | null) {
  const ownerId = useOwnerId()
  const cycles = useCycles(ownerId)

  return useMemo(() => {
    const logs = cycles.data ?? []
    if (!from || !to || logs.length === 0) return new Map<DateOnly, DayMark>()
    // Enough projections to cover the range; the helper caps and trims them.
    return calendarMarks(logs, predictCycles(logs, MAX_PROJECTED_CYCLES, from), from, to)
  }, [cycles.data, from, to])
}

export function useLogCycle() {
  const qc = useQueryClient()
  const ownerId = useOwnerId()
  return useMutation({
    mutationFn: (input: Omit<InsertDto<'cycle_logs'>, 'owner_id'>) =>
      api.logCycle(ownerId!, input),
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'cycles' }),
  })
}

export function useUpdateCycle() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateDto<'cycle_logs'> }) =>
      api.updateCycle(id, patch),
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'cycles' }),
  })
}

export function useDeleteCycle() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.deleteCycle,
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'cycles' }),
  })
}

export function useHealthRecords(ownerId: string | null, kind?: RecordKind) {
  return useQuery({
    queryKey: qk.healthRecords(ownerId ?? 'none', kind ?? 'all'),
    queryFn: () => api.listRecords(ownerId!, kind),
    enabled: Boolean(ownerId),
  })
}

export function useAddRecord() {
  const qc = useQueryClient()
  const ownerId = useOwnerId()
  return useMutation({
    mutationFn: (input: Omit<InsertDto<'health_records'>, 'owner_id'>) =>
      api.addRecord(ownerId!, input),
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'health-records' }),
  })
}

export function useUpdateRecord() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateDto<'health_records'> }) =>
      api.updateRecord(id, patch),
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'health-records' }),
  })
}

export function useDeleteRecord() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.deleteRecord,
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'health-records' }),
  })
}

export function useRestrictions(countryCode: string | null) {
  return useQuery({
    queryKey: qk.restrictions(countryCode ?? 'none'),
    queryFn: () => api.listRestrictions(countryCode!),
    enabled: Boolean(countryCode),
    // Reference data; changes by migration.
    staleTime: 60 * 60_000,
  })
}

export function useDeleteAllHealthData() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.deleteAllHealthData,
    // Everything, because everything is gone.
    onSuccess: () => qc.clear(),
  })
}
