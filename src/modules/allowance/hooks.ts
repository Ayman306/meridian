'use client'

import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { qk } from '@/lib/queryClient'
import { todayIn } from '@/lib/dates'
import { useAuth } from '@/providers/AuthProvider'
import { useCouple } from '@/providers/CoupleProvider'
import type { UpdateDto } from '@/types/database'
import * as api from './api'
import { checkPlannedStay, ruleFor, staysForRule, suggestFromTrip } from './logic'
import type { AllowanceCheck, LogSuggestion } from './types'

export function useAllowanceRules() {
  const { coupleId } = useCouple()
  return useQuery({
    queryKey: qk.allowanceRules(coupleId ?? 'none'),
    queryFn: api.listRules,
    enabled: Boolean(coupleId),
    // Defaults change by migration; overrides invalidate on write.
    staleTime: 5 * 60_000,
  })
}

export function useEntryLog() {
  const { coupleId } = useCouple()
  return useQuery({
    queryKey: qk.entryLog(coupleId ?? 'none'),
    queryFn: () => api.listLog(coupleId!),
    enabled: Boolean(coupleId),
  })
}

export function useLogEntry() {
  const qc = useQueryClient()
  const { coupleId } = useCouple()
  const { user } = useAuth()
  return useMutation({
    mutationFn: (input: api.LogEntryInput) => api.logEntry(coupleId!, user!.id, input),
    onSuccess: () => invalidate(qc),
  })
}

export function useUpdateLogEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateDto<'entry_exit_log'> }) =>
      api.updateLogEntry(id, patch),
    onSuccess: () => invalidate(qc),
  })
}

export function useDeleteLogEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteLogEntry(id),
    onSuccess: () => invalidate(qc),
  })
}

export function useUpsertRule() {
  const qc = useQueryClient()
  const { coupleId } = useCouple()
  const { user } = useAuth()
  return useMutation({
    mutationFn: (input: api.RuleInput) => api.upsertRule(coupleId!, user!.id, input),
    onSuccess: () => invalidate(qc),
  })
}

export function useDeleteRule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteRule(id),
    onSuccess: () => invalidate(qc),
  })
}

/**
 * Would this trip breach either partner's allowance?
 *
 * Computed in the browser from data already fetched, because the answer has to
 * appear at planning time — inline on the trip and on the destination board —
 * and a round trip per candidate city would make the board crawl.
 */
export function useTripAllowanceCheck(
  countryCode: string | null,
  from: string | null,
  to: string | null,
): Record<string, AllowanceCheck> {
  const { self, partner, tzSelf } = useCouple()
  const rules = useAllowanceRules()
  const log = useEntryLog()

  return useMemo(() => {
    if (!countryCode || !from || !to) return {}
    const today = todayIn(tzSelf)
    const out: Record<string, AllowanceCheck> = {}

    for (const person of [self, partner]) {
      if (!person) continue
      const rule = ruleFor(rules.data ?? [], person.id, countryCode, [
        person.nationality,
        person.second_nationality,
      ])
      const theirLog = (log.data ?? []).filter((row) => row.user_id === person.id)
      const stays = rule ? staysForRule(theirLog, rule) : []
      out[person.id] = checkPlannedStay(stays, from, to, rule, today)
    }

    return out
  }, [countryCode, from, to, rules.data, log.data, self, partner, tzSelf])
}

/**
 * Stays visible in the trips but missing from the log.
 *
 * Suggestions only. Spec 10.2 asks the question and waits for an answer;
 * writing a border crossing nobody confirmed would be the app inventing a fact
 * about someone's immigration history.
 */
export function useLogSuggestions(): LogSuggestion[] {
  const { coupleId } = useCouple()
  const log = useEntryLog()

  const trips = useQuery({
    queryKey: ['allowance-trip-suggestions', coupleId ?? 'none'] as const,
    queryFn: () => api.listTripsForSuggestions(coupleId!),
    enabled: Boolean(coupleId),
    staleTime: 60_000,
  })

  return useMemo(() => {
    if (!trips.data || !log.data) return []
    return trips.data.flatMap((trip) =>
      suggestFromTrip(trip, trip.country_code, trip.travellers, log.data!),
    )
  }, [trips.data, log.data])
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'entry-log' })
  void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'allowance-rules' })
  void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'allowance-trip-suggestions' })
  // The dashboard reserves an alert slot for allowance warnings.
  void qc.invalidateQueries({ queryKey: qk.dashboard })
}
