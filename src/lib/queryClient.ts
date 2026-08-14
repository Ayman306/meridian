import { QueryClient } from '@tanstack/react-query'
import { AppError, toAppError } from '@/lib/errors'
import { QUERY_STALE_TIME_MS } from '@/lib/constants'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: QUERY_STALE_TIME_MS,
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => {
        const e = toAppError(error)
        // Never retry a permission or validation failure — it will never pass.
        if (!e.retryable && e.kind !== 'unknown') return false
        return failureCount < 2
      },
    },
    mutations: {
      retry: false,
      throwOnError: false,
    },
  },
})

/**
 * Query keys live in one place so realtime handlers and mutations invalidate
 * exactly the right slices. Every key starts with its module name.
 */
export const qk = {
  session: ['session'] as const,
  profile: (userId: string) => ['profile', userId] as const,
  couple: ['couple'] as const,
  partner: ['partner'] as const,
  dashboard: ['dashboard'] as const,

  trips: (filter?: string) => ['trips', filter ?? 'all'] as const,
  trip: (id: string) => ['trip', id] as const,
  tripDays: (tripId: string) => ['trip-days', tripId] as const,
  tripTravelers: (tripId: string) => ['trip-travelers', tripId] as const,
  tripStatuses: ['trip-statuses'] as const,

  itinerary: (tripId: string) => ['itinerary', tripId] as const,
  categories: ['categories'] as const,
  tray: (tripId: string) => ['suggestion-tray', tripId] as const,

  wishlist: (coupleId: string) => ['wishlist', coupleId] as const,

  destinations: (tripId: string) => ['destinations', tripId] as const,
  visaRules: (key: string) => ['visa-rules', key] as const,
  destinationWeights: ['destination-weights'] as const,
  wishlistCities: ['wishlist-cities'] as const,

  media: (coupleId: string, filters: string) => ['media', coupleId, filters] as const,
  mediaItem: (id: string) => ['media-item', id] as const,
  mediaTrash: (coupleId: string) => ['media-trash', coupleId] as const,
  mediaUsage: ['media-usage'] as const,
  albums: (coupleId: string) => ['albums', coupleId] as const,
  shareLinks: (coupleId: string) => ['share-links', coupleId] as const,

  flights: (coupleId: string) => ['flights', coupleId] as const,
  flight: (id: string) => ['flight', id] as const,
  flightTrack: (id: string) => ['flight-track', id] as const,

  allowanceRules: (userId: string) => ['allowance-rules', userId] as const,
  entryLog: (coupleId: string) => ['entry-log', coupleId] as const,

  mapPins: (scope: string) => ['map-pins', scope] as const,
  geocode: (query: string) => ['geocode', query] as const,

  documents: (filter?: string) => ['documents', filter ?? 'all'] as const,
  signedUrl: (path: string) => ['signed-url', path] as const,
  document: (id: string) => ['document', id] as const,
  documentTypes: ['document-types'] as const,
  readiness: (tripId: string) => ['readiness', tripId] as const,
}

export function isAuthError(error: unknown): boolean {
  return error instanceof AppError && error.kind === 'auth'
}
