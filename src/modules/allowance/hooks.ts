'use client'

import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { qk } from '@/lib/queryClient'
import { todayIn } from '@/lib/dates'
import { useAuth } from '@/providers/AuthProvider'
import { useCouple } from '@/providers/CoupleProvider'
import type { UpdateDto } from '@/types/database'
import { useCoupleRealtime } from '@/lib/realtime'
import * as api from './api'
import { checkTripAgainstPlans, checkTripsAhead, ruleFor, staysForRule, suggestFromTrip } from './logic'
import type { AllowanceCheck, LogSuggestion, TripAhead } from './types'

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

/**
 * A border crossing either of you logs changes both of your day counts.
 *
 * Not because you share an allowance — you do not, the counts are per person —
 * but because the screen shows both, and a stale one is a number somebody might
 * book a flight against.
 */
export function useAllowanceRealtime() {
  const qc = useQueryClient()
  const { coupleId } = useCouple()

  useCoupleRealtime(
    'allowance',
    coupleId,
    [
      { table: 'entry_exit_log', filterColumn: 'couple_id' },
      // Overrides are couple-scoped too, and a partner adding one for their own
      // passport changes what this screen should show for them.
      { table: 'allowance_rules', filterColumn: 'couple_id' },
    ],
    () => {
      void qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('allowance') })
      void qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('entr') })
    },
  )
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
 * Every dated trip with its chosen country and each traveller's dates.
 *
 * Shared by the log suggestions and by every check that counts other plans.
 * Always refetched on mount rather than cached for a minute: a trip's dates
 * and its chosen destination are edited on screens that invalidate only that
 * trip, so a cached copy here could keep counting a plan that has since
 * moved. The trip being checked never comes from this list — it is excluded
 * and passed in fresh — so only the others could be stale, and they are
 * edited somewhere else, which means a remount.
 */
export function usePlannedTrips() {
  const { coupleId } = useCouple()
  return useQuery({
    queryKey: qk.plannedTrips(coupleId ?? 'none'),
    queryFn: () => api.listPlannedTrips(coupleId!),
    enabled: Boolean(coupleId),
    staleTime: 0,
  })
}

/**
 * Would this trip breach either partner's allowance?
 *
 * Computed in the browser from data already fetched, because the answer has to
 * appear at planning time — inline on the trip and on the destination board —
 * and a round trip per candidate city would make the board crawl.
 *
 * Counts the person's other planned trips as well as their log (D140), so two
 * visits that each fit but do not fit together are caught on both. `tripId`
 * is the trip being checked, left out of those plans so it is not counted as
 * its own neighbour.
 */
export function useTripAllowanceCheck(
  countryCode: string | null,
  from: string | null,
  to: string | null,
  tripId: string | null = null,
): Record<string, AllowanceCheck> {
  const { self, partner, tzSelf } = useCouple()
  const rules = useAllowanceRules()
  const log = useEntryLog()
  const planned = usePlannedTrips()

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
      out[person.id] = checkTripAgainstPlans(
        stays,
        planned.data ?? [],
        person.id,
        tripId,
        from,
        to,
        rule,
        today,
      )
    }

    return out
  }, [countryCode, from, to, tripId, rules.data, log.data, planned.data, self, partner, tzSelf])
}

/**
 * Every upcoming trip checked for both partners. What the dashboard warns
 * from; see `checkTripsAhead`.
 */
export function useTripsAhead(): TripAhead[] {
  const { self, partner, tzSelf } = useCouple()
  const rules = useAllowanceRules()
  const log = useEntryLog()
  const planned = usePlannedTrips()

  return useMemo(() => {
    if (!planned.data || !rules.data || !log.data) return []
    const people = [self, partner]
      .filter((p): p is NonNullable<typeof p> => p !== null)
      .map((p) => ({ id: p.id, passports: [p.nationality, p.second_nationality] }))
    return checkTripsAhead(planned.data, people, rules.data, log.data, todayIn(tzSelf))
  }, [planned.data, rules.data, log.data, self, partner, tzSelf])
}

/**
 * Stays visible in the trips but missing from the log.
 *
 * Suggestions only. Spec 10.2 asks the question and waits for an answer;
 * writing a border crossing nobody confirmed would be the app inventing a fact
 * about someone's immigration history.
 */
export function useLogSuggestions(): LogSuggestion[] {
  const log = useEntryLog()
  const trips = usePlannedTrips()

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
  void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'planned-trips' })
  // The dashboard reserves an alert slot for allowance warnings.
  void qc.invalidateQueries({ queryKey: qk.dashboard })
}
