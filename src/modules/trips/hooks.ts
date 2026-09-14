'use client'

import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { qk } from '@/lib/queryClient'
import { supabase } from '@/lib/supabase/client'
import { useCouple } from '@/providers/CoupleProvider'
import { todayIn, type DateOnly } from '@/lib/dates'
import * as api from './api'
import { needsHorizonRefresh } from './logic'
import type { DatePrecision, DayType, TripDetail } from './types'
import type { UpdateDto } from '@/types/database'

export function useTrips() {
  const { coupleId } = useCouple()
  return useQuery({
    queryKey: qk.trips(coupleId ?? 'none'),
    queryFn: () => api.listTrips(coupleId!),
    enabled: Boolean(coupleId),
  })
}

export function useTripStatuses() {
  const { coupleId } = useCouple()
  return useQuery({
    queryKey: qk.tripStatuses,
    queryFn: () => api.listTripStatuses(coupleId!),
    enabled: Boolean(coupleId),
    // Statuses change about once a year.
    staleTime: 10 * 60_000,
  })
}

export function useTrip(id: string | undefined) {
  return useQuery({
    queryKey: qk.trip(id ?? 'none'),
    queryFn: () => api.getTrip(id!),
    enabled: Boolean(id),
  })
}

/**
 * Keep an open-ended trip's day grid from being overtaken by the calendar.
 *
 * 0035 made the database's horizon roll forward, but only when something asks.
 * This is what asks: on opening a trip whose scaffolding has fallen short of
 * thirty days out, it re-syncs once and refetches. `needsHorizonRefresh`
 * answers from the days already loaded, so a healthy grid — which is every
 * dated trip and most open-ended ones — costs nothing and writes nothing.
 */
export function useRollingHorizon(trip: TripDetail | null | undefined) {
  const qc = useQueryClient()
  const { tzSelf } = useCouple()
  const syncing = useRef(false)

  useEffect(() => {
    if (!trip || syncing.current) return
    if (!needsHorizonRefresh(trip, trip.days, todayIn(tzSelf))) return

    syncing.current = true
    void api
      .syncTripDays(trip.id)
      .then(() => qc.invalidateQueries({ queryKey: qk.trip(trip.id) }))
      // A grid that stops at yesterday is a worse day than a silent failure
      // here; the trip still renders everything it already has.
      .catch(() => undefined)
      .finally(() => {
        syncing.current = false
      })
  }, [trip, qc, tzSelf])
}

export function useDeletedTrips() {
  const { coupleId } = useCouple()
  return useQuery({
    queryKey: qk.trips('deleted'),
    queryFn: () => api.listDeletedTrips(coupleId!),
    enabled: Boolean(coupleId),
  })
}

export function useCreateTrip() {
  const qc = useQueryClient()
  const { coupleId } = useCouple()
  return useMutation({
    mutationFn: (input: Omit<api.CreateTripInput, 'couple_id'>) =>
      api.createTrip({ ...input, couple_id: coupleId! }),
    onSuccess: () => invalidateTrips(qc),
  })
}

export function useUpdateTrip(tripId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: UpdateDto<'trips'>) => api.updateTrip(tripId, patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.trip(tripId) })
      void invalidateTrips(qc)
    },
  })
}

export function useSetTripDates(tripId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      start: DateOnly | null
      end: DateOnly | null
      precision: DatePrecision
      isOpenEnded?: boolean
    }) => api.setTripDates(tripId, input.start, input.end, input.precision, input.isOpenEnded),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.trip(tripId) })
      void qc.invalidateQueries({ queryKey: qk.itinerary(tripId) })
      void invalidateTrips(qc)
    },
  })
}

export function useSetTravelerDates(tripId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      userId,
      ...patch
    }: {
      userId: string
      arrival_date?: DateOnly | null
      departure_date?: DateOnly | null
      origin_airport?: string | null
    }) => api.setTravelerDates(tripId, userId, patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.trip(tripId) })
      void invalidateTrips(qc)
    },
  })
}

export function useSetDayType(tripId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ date, dayType }: { date: DateOnly; dayType: DayType }) =>
      api.setDayType(tripId, date, dayType),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.trip(tripId) }),
  })
}

export function useDeleteTrip() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteTrip(id),
    onSuccess: () => invalidateTrips(qc),
  })
}

export function useRestoreTrip() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.restoreTrip(id),
    onSuccess: () => invalidateTrips(qc),
  })
}

function invalidateTrips(qc: ReturnType<typeof useQueryClient>) {
  return qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'trips' })
}

/**
 * Both partners editing one trip at the same time is normal, not an edge case.
 * Subscribe to the trip's tables and invalidate; last write wins (spec 0.8).
 */
export function useTripRealtime(tripId: string | undefined) {
  const qc = useQueryClient()

  useEffect(() => {
    if (!tripId) return

    const invalidate = () => {
      void qc.invalidateQueries({ queryKey: qk.trip(tripId) })
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'trips' })
    }

    const channel = supabase
      .channel(`trip:${tripId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trips', filter: `id=eq.${tripId}` },
        invalidate,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trip_travelers', filter: `trip_id=eq.${tripId}` },
        invalidate,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trip_days', filter: `trip_id=eq.${tripId}` },
        invalidate,
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [tripId, qc])
}
