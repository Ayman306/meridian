'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { qk } from '@/lib/queryClient'
import { ACCENT_COLORS } from '@/lib/constants'
import { searchPlaces, type PlaceResult } from '@/lib/geocode'
import { useCouple } from '@/providers/CoupleProvider'
import type { PersonRef } from '@/types/domain'
import * as api from './api'

export function useMapData(tripId: string | null) {
  const { coupleId } = useCouple()
  return useQuery({
    queryKey: qk.mapPins(tripId ?? 'all'),
    queryFn: () => api.getMapData(coupleId!, tripId),
    enabled: Boolean(coupleId),
  })
}

/**
 * Pin colour and popup name, by whose pick it is.
 *
 * Colour is the couple's own accent choice rather than a map palette — the
 * same colour that marks their items everywhere else in the app, so the map
 * needs no legend to be readable.
 */
export function usePinPeople() {
  const { selfRef, partnerRef } = useCouple()

  return useMemo(() => {
    const people = [selfRef, partnerRef].filter((p): p is PersonRef => p !== null)
    const byId = new Map(people.map((p) => [p.id, p]))

    return {
      people,
      colorFor: (personId: string | null) => {
        const person = personId ? byId.get(personId) : null
        const hue = person ? ACCENT_COLORS[person.accentColor] : null
        // Nobody's pick — an item added before anyone claimed it.
        return hue ? `hsl(${hue})` : 'hsl(220 10% 62%)'
      },
      nameFor: (personId: string | null) => {
        const person = personId ? byId.get(personId) : null
        if (!person) return ''
        return person.isSelf ? 'Your pick' : `${person.displayName}'s pick`
      },
    }
  }, [selfRef, partnerRef])
}

/** Spec 6.3: 600ms, so a typed word is one request rather than eight. */
const DEBOUNCE_MS = 600

export function useDebounced<T>(value: T, delay = DEBOUNCE_MS): T {
  const [settled, setSettled] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return settled
}

/**
 * Place search, debounced and cached.
 *
 * The cache is checked before the network on every keystroke that survives the
 * debounce, which is what makes the spec's acceptance test true: the same query
 * twice is one network call. TanStack's own cache would cover a session; the
 * table covers both partners and every session after this one.
 */
export function usePlaceSearch(query: string) {
  const settled = useDebounced(query.trim())

  return useQuery({
    queryKey: qk.geocode(api.cacheKey(settled)),
    enabled: settled.length >= 2,
    // Nominatim is a free service that asked us not to hammer it. Nothing
    // about a place name goes stale inside a session.
    staleTime: 60 * 60_000,
    retry: false,
    queryFn: async (): Promise<PlaceResult[]> => {
      const cached = await api.readGeocodeCache(settled)
      if (cached) return cached

      const results = await searchPlaces(settled)
      await api.writeGeocodeCache(settled, results)
      return results
    },
  })
}
