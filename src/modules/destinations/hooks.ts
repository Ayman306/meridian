'use client'

import { useMemo } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { qk } from '@/lib/queryClient'
import { useAuth } from '@/providers/AuthProvider'
import { useCouple } from '@/providers/CoupleProvider'
import type { UpdateDto } from '@/types/database'
import * as api from './api'
import type { ScoreWeights } from './types'

export function useDestinations(tripId: string | undefined) {
  return useQuery({
    queryKey: qk.destinations(tripId ?? 'none'),
    queryFn: () => api.listDestinations(tripId!),
    enabled: Boolean(tripId),
  })
}

export function useAddCandidate(tripId: string) {
  const qc = useQueryClient()
  const { coupleId } = useCouple()
  const { user } = useAuth()

  return useMutation({
    mutationFn: (input: api.CandidateInput) =>
      api.addCandidate(coupleId!, tripId, user!.id, input),
    onSuccess: () => invalidate(qc, tripId),
  })
}

export function useUpdateDestination(tripId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateDto<'trip_destinations'> }) =>
      api.updateDestination(id, patch),
    onSuccess: () => invalidate(qc, tripId),
  })
}

export function useRemoveDestination(tripId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.removeDestination(id),
    onSuccess: () => invalidate(qc, tripId),
  })
}

/** Choosing sets the trip's timezone, so the trip has to be refetched too. */
export function useChooseDestination(tripId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, chosen }: { id: string; chosen: boolean }) =>
      chosen ? api.chooseDestination(id) : api.unchooseDestination(id),
    onSuccess: () => invalidate(qc, tripId),
  })
}

/**
 * The reference data the board needs: visa rules for these passports against
 * these countries, and any cached flight durations.
 *
 * Keyed on the actual pairs so adding a candidate refetches, and cached for an
 * hour — reference data that changes by migration does not need revalidating
 * on window focus.
 */
export function useBoardReference(
  passports: readonly string[],
  countries: readonly (string | null)[],
  origins: readonly string[],
) {
  const passportKey = [...new Set(passports)].sort().join(',')
  const countryKey = [...new Set(countries.filter(Boolean))].sort().join(',')
  const originKey = [...new Set(origins)].sort().join(',')

  const [rules, routes] = useQueries({
    queries: [
      {
        queryKey: qk.visaRules(`${passportKey}|${countryKey}`),
        queryFn: () => api.listVisaRules(passports, countries),
        enabled: passportKey.length > 0 && countryKey.length > 0,
        staleTime: 60 * 60_000,
      },
      {
        queryKey: ['airport-routes', originKey] as const,
        queryFn: () => api.listAirportRoutes(origins),
        enabled: originKey.length > 0,
        staleTime: 60 * 60_000,
      },
    ],
  })

  return useMemo(
    () => ({
      visaRules: rules.data ?? [],
      routes: routes.data ?? [],
      isLoading: rules.isLoading || routes.isLoading,
      error: rules.error ?? routes.error,
    }),
    [rules.data, rules.isLoading, rules.error, routes.data, routes.isLoading, routes.error],
  )
}

export function useWeights() {
  const { coupleId } = useCouple()
  return useQuery({
    queryKey: qk.destinationWeights,
    queryFn: () => api.getWeights(coupleId!),
    enabled: Boolean(coupleId),
    staleTime: 5 * 60_000,
  })
}

export function useSaveWeights() {
  const qc = useQueryClient()
  const { coupleId } = useCouple()
  return useMutation({
    mutationFn: (weights: ScoreWeights) => api.saveWeights(coupleId!, weights),
    // Sliders move continuously; snapping the board back to the server's copy
    // between drags would fight the user's hand.
    onMutate: (weights) => {
      qc.setQueryData(qk.destinationWeights, weights)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.destinationWeights }),
  })
}

export function useWishlistCities() {
  const { coupleId } = useCouple()
  return useQuery({
    queryKey: qk.wishlistCities,
    queryFn: () => api.wishlistCountsByCity(coupleId!),
    enabled: Boolean(coupleId),
  })
}

function invalidate(qc: ReturnType<typeof useQueryClient>, tripId: string) {
  void qc.invalidateQueries({ queryKey: qk.destinations(tripId) })
  void qc.invalidateQueries({ queryKey: qk.trip(tripId) })
}

/**
 * The chosen destination's country for a trip. Null while nothing is chosen.
 *
 * Separate from the board's own queries because the dashboard needs exactly
 * this one field and nothing else on the screen wants the rest.
 */
export function useChosenCountry(tripId: string | null | undefined) {
  return useQuery({
    queryKey: ['chosen-country', tripId ?? 'none'] as const,
    queryFn: () => api.getChosenCountry(tripId!),
    enabled: Boolean(tripId),
    // Changes only when somebody chooses a different city.
    staleTime: 5 * 60_000,
  })
}
