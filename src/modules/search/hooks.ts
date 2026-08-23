'use client'

import { useQuery } from '@tanstack/react-query'
import { useDebounced } from '@/modules/map'
import { useCouple } from '@/providers/CoupleProvider'
import * as api from './api'
import { isSearchable } from './logic'

/**
 * Search, debounced.
 *
 * 200ms rather than the map's 600: this is one indexed query against the
 * couple's own rows, not a rate-limited third party, and a search box that lags
 * a third of a second behind the keyboard feels broken in a way a geocoder does
 * not.
 *
 * `placeholderData` keeps the previous results on screen while the next query
 * runs. Without it every keystroke empties the list and refills it, which reads
 * as "no results" for a moment on every single character.
 */
export function useSearch(query: string) {
  const { coupleId } = useCouple()
  const debounced = useDebounced(query, 200)

  return useQuery({
    queryKey: ['search', coupleId ?? 'none', debounced] as const,
    queryFn: () => api.searchEverything(debounced),
    enabled: Boolean(coupleId) && isSearchable(debounced),
    placeholderData: (previous) => previous,
    // Results go stale the moment anything is edited, and the palette is opened
    // for seconds at a time. Refetching on every open costs a query nobody
    // reads; ten seconds is long enough to reopen without one.
    staleTime: 10_000,
  })
}
