'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { qk } from '@/lib/queryClient'
import { supabase } from '@/lib/supabase/client'
import { useAuth } from '@/providers/AuthProvider'
import { useCouple } from '@/providers/CoupleProvider'
import type { UpdateDto } from '@/types/database'
import * as api from './api'
import { buildFlightState } from './state'
import { bothFlying, isAirbornePhase, isFinished, type FlightGroup } from './logic'
import type { FlightPosition, FlightRow, FlightState, Phase } from './types'

/** Spec 9.8: 60s while open, paused when hidden. */
const TICK_MS = 60_000
/** Client-side cooldown on the manual button. The server enforces its own. */
const MANUAL_COOLDOWN_MS = 60_000

export function useFlights() {
  const { coupleId } = useCouple()
  return useQuery({
    queryKey: qk.flights(coupleId ?? 'none'),
    queryFn: () => api.listFlights(coupleId!),
    enabled: Boolean(coupleId),
  })
}

export function useFlight(id: string | undefined) {
  return useQuery({
    queryKey: qk.flight(id ?? 'none'),
    queryFn: () => api.getFlight(id!),
    enabled: Boolean(id),
  })
}

export function useFlightTrack(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: qk.flightTrack(id ?? 'none'),
    queryFn: () => api.getFlightTrack(id!),
    enabled: Boolean(id) && enabled,
  })
}

export function useLatestPositions(flightIds: readonly string[]) {
  const key = [...flightIds].sort().join(',')
  return useQuery({
    queryKey: ['flight-positions', key] as const,
    queryFn: () => api.latestPositions(flightIds),
    enabled: flightIds.length > 0,
  })
}

export function useAddFlight() {
  const qc = useQueryClient()
  const { coupleId } = useCouple()
  const { user } = useAuth()
  return useMutation({
    mutationFn: (input: Omit<api.FlightInput, 'created_by'>) =>
      api.addFlight(coupleId!, { ...input, created_by: user?.id ?? null }),
    onSuccess: () => invalidate(qc),
  })
}

export function useUpdateFlight() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateDto<'flights'> }) =>
      api.updateFlight(id, patch),
    onSuccess: (flight) => {
      void qc.invalidateQueries({ queryKey: qk.flight(flight.id) })
      invalidate(qc)
    },
  })
}

export function useSetManualOverride() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, override }: { id: string; override: Record<string, unknown> }) =>
      api.setManualOverride(id, override),
    onSuccess: (flight) => {
      void qc.invalidateQueries({ queryKey: qk.flight(flight.id) })
      invalidate(qc)
    },
  })
}

export function useStopTracking() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.stopTracking(id),
    onSuccess: () => invalidate(qc),
  })
}

export function useDeleteFlight() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteFlight(id),
    onSuccess: () => invalidate(qc),
  })
}

export function useLookupFlight() {
  return useMutation({
    mutationFn: ({ flightNumber, date }: { flightNumber: string; date: string }) =>
      api.lookupFlight(flightNumber, date),
  })
}

export function useReportWait() {
  const qc = useQueryClient()
  const { user } = useAuth()
  return useMutation({
    mutationFn: ({
      iata,
      minutes,
    }: {
      iata: string
      minutes: { immigration?: number; baggage?: number }
    }) => api.reportActualWait(iata, user!.id, minutes),
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'wait-times' }),
  })
}

export function useWaitTimes(iata: string | null) {
  return useQuery({
    queryKey: ['wait-times', iata ?? 'none'] as const,
    queryFn: () => api.getWaitTimes(iata),
    enabled: Boolean(iata),
    staleTime: 10 * 60_000,
  })
}

export function useQuotaUsage() {
  return useQuery({
    queryKey: ['api-quota'] as const,
    queryFn: api.getQuotaUsage,
    staleTime: 5 * 60_000,
  })
}

/**
 * The live tick.
 *
 * Three rules, each one a line in spec 9.14's cost-control acceptance list:
 * pause when the tab is hidden and refresh immediately on focus; never poll a
 * flight that is finished; and let the *server* decide whether a poll turns
 * into an API call, so a fast interval here cannot become spend.
 */
export function useFlightRefresh(flights: readonly FlightRow[], phases: Record<string, Phase>) {
  const qc = useQueryClient()
  const [notices, setNotices] = useState<string[]>([])
  // A boolean on a timer rather than a timestamp compared during render:
  // reading the clock while rendering makes the result depend on when React
  // happened to re-render, which is not something a button should depend on.
  const [cooling, setCooling] = useState(false)
  const inFlight = useRef(false)

  // Only what is worth asking about. A landed flight and a trip six months out
  // are both zero-value polls, and the second one is the common case.
  const trackable = useMemo(
    () =>
      flights
        .filter((f) => {
          if (!f.tracking_active || f.deleted_at) return false
          const phase = phases[f.id] ?? (f.phase as Phase)
          return !isFinished(phase)
        })
        .map((f) => f.id),
    [flights, phases],
  )

  const key = trackable.join(',')

  const refresh = useCallback(async () => {
    if (!key || inFlight.current) return
    inFlight.current = true
    try {
      const result = await api.refreshFlights(key.split(','))
      setNotices(result.notices)
      if (result.flights.length > 0) {
        void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'flights' })
        void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'flight-positions' })
      }
    } finally {
      inFlight.current = false
    }
  }, [key, qc])

  useEffect(() => {
    if (!key) return

    let timer: ReturnType<typeof setInterval> | null = null

    const start = () => {
      if (timer) return
      timer = setInterval(() => void refresh(), TICK_MS)
    }
    const stop = () => {
      if (timer) clearInterval(timer)
      timer = null
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        // Whatever happened while the tab was hidden, catch up now.
        void refresh()
        start()
      } else {
        stop()
      }
    }

    if (document.visibilityState === 'visible') {
      void refresh()
      start()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [key, refresh])

  useEffect(() => {
    if (!cooling) return
    const timer = setTimeout(() => setCooling(false), MANUAL_COOLDOWN_MS)
    return () => clearTimeout(timer)
  }, [cooling])

  const manualRefresh = useCallback(() => {
    if (cooling) return
    setCooling(true)
    void refresh()
  }, [cooling, refresh])

  return { notices, manualRefresh, canRefresh: !cooling, trackableCount: trackable.length }
}

/**
 * Everything a screen needs, assembled.
 *
 * Realtime keeps both partners in step: whichever of them refreshed first pays
 * for the call, and the other sees the result without making one (spec 9.4).
 */
export function useFlightStates(flights: readonly FlightRow[]): FlightState[] {
  const { selfRef, partnerRef, self, partner } = useCouple()
  const ids = useMemo(() => flights.map((f) => f.id), [flights])
  const positions = useLatestPositions(ids)

  const positionByFlight = useMemo(() => {
    const map = new Map<string, FlightPosition>()
    for (const p of positions.data ?? []) map.set(p.flight_id, p)
    return map
  }, [positions.data])

  return useMemo(() => {
    const people = { self: selfRef, partner: partnerRef }

    const first = flights.map((flight) =>
      buildFlightState({
        flight,
        position: positionByFlight.get(flight.id) ?? null,
        people,
      }),
    )

    // Both flying to the same place means nobody is waiting, so no handoff
    // (spec 9.8). That can only be known once every state exists, hence the
    // second pass.
    const active = first.filter((s) => !isFinished(s.phase))
    const { isBoth } = bothFlying(active)
    if (!isBoth) return first

    return flights.map((flight) => {
      const watcherProfile = flight.traveler_id === self?.id ? partner : self
      return buildFlightState({
        flight,
        position: positionByFlight.get(flight.id) ?? null,
        people,
        suppressHandoff: true,
        watcherHome:
          watcherProfile?.home_lat != null && watcherProfile?.home_lng != null
            ? { lat: Number(watcherProfile.home_lat), lng: Number(watcherProfile.home_lng) }
            : null,
      })
    })
  }, [flights, positionByFlight, selfRef, partnerRef, self, partner])
}

/** One flight, with the watcher's home and measured wait times folded in. */
export function useFlightState(flight: FlightRow | undefined): FlightState | null {
  const { selfRef, partnerRef, self, partner } = useCouple()
  const positions = useLatestPositions(flight ? [flight.id] : [])
  const waitTimes = useWaitTimes(flight?.dest_iata ?? null)

  return useMemo(() => {
    if (!flight) return null
    const watcherProfile = flight.traveler_id === self?.id ? partner : self

    return buildFlightState({
      flight,
      position: positions.data?.[0] ?? null,
      people: { self: selfRef, partner: partnerRef },
      waitTimes: waitTimes.data,
      watcherHome:
        watcherProfile?.home_lat != null && watcherProfile?.home_lng != null
          ? { lat: Number(watcherProfile.home_lat), lng: Number(watcherProfile.home_lng) }
          : null,
    })
  }, [flight, positions.data, waitTimes.data, selfRef, partnerRef, self, partner])
}

/** Both partners watch the same row; one poll updates both screens. */
export function useFlightRealtime(coupleId: string | null) {
  const qc = useQueryClient()

  useEffect(() => {
    if (!coupleId) return

    const refresh = () => {
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'flights' })
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'flight-positions' })
    }

    const channel = supabase
      .channel(`flights:${coupleId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'flights', filter: `couple_id=eq.${coupleId}` },
        refresh,
      )
      // Positions carry no couple_id to filter on; RLS already limits what
      // arrives, and a position insert is exactly what the other screen wants.
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'flight_positions' }, refresh)
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [coupleId, qc])
}

/**
 * Respect the setting before animating a marker across the map.
 *
 * Subscribed rather than mirrored into state: writing the initial value from
 * an effect body is a cascading render, and the media query is exactly the
 * kind of external store this hook exists for. `false` on the server, because
 * there is no window to ask.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia('(prefers-reduced-motion: reduce)')
      query.addEventListener('change', onChange)
      return () => query.removeEventListener('change', onChange)
    },
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => false,
  )
}

export function useGroupedFlights(states: readonly FlightState[]): Record<FlightGroup, FlightState[]> {
  return useMemo(() => {
    const groups: Record<FlightGroup, FlightState[]> = { active: [], upcoming: [], past: [] }
    for (const state of states) {
      const group = isAirbornePhase(state.phase)
        ? 'active'
        : isFinished(state.phase)
          ? 'past'
          : state.phase === 'boarding' || state.phase === 'checkin'
            ? 'active'
            : 'upcoming'
      groups[group].push(state)
    }
    return groups
  }, [states])
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'flights' })
  void qc.invalidateQueries({ queryKey: qk.dashboard })
}
