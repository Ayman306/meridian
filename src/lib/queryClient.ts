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

  documents: (filter?: string) => ['documents', filter ?? 'all'] as const,
  document: (id: string) => ['document', id] as const,
  documentTypes: ['document-types'] as const,
  readiness: (tripId: string) => ['readiness', tripId] as const,
}

export function isAuthError(error: unknown): boolean {
  return error instanceof AppError && error.kind === 'auth'
}
