/**
 * Deleted trips, and the way back.
 *
 * `useDeletedTrips` and `useRestoreTrip` have both existed since Phase 2 with
 * nothing calling them, which meant deleting a trip was reversible in the
 * database and irreversible from the app — the worst of both, because the
 * dialog promised a bin that could not be opened.
 *
 * The countdown is per trip rather than a sentence about policy. "Deleted trips
 * are removed after 30 days" is something to agree with; "gone in four days" is
 * something to act on.
 */
'use client'

import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState, ErrorState, SkeletonList } from '@/components/common/states'
import { SOFT_DELETE_GRACE_DAYS } from '@/lib/constants'
import { pluralise } from '@/lib/utils'
import { useDeletedTrips, useRestoreTrip } from '../hooks'
import { formatTripDates } from '../logic'

export function TripBin() {
  const deleted = useDeletedTrips()
  const restore = useRestoreTrip()

  // Read once at mount. Calling Date.now() during render makes the countdown
  // depend on when React happened to re-render, and nothing here changes
  // within a day.
  const [now] = useState(() => Date.now())

  const daysLeft = (deletedAt: string | null) => {
    if (!deletedAt) return SOFT_DELETE_GRACE_DAYS
    const elapsed = (now - new Date(deletedAt).getTime()) / 86_400_000
    return Math.max(0, Math.ceil(SOFT_DELETE_GRACE_DAYS - elapsed))
  }

  if (deleted.isLoading) return <SkeletonList rows={2} />
  if (deleted.error) {
    return <ErrorState error={deleted.error} onRetry={() => void deleted.refetch()} />
  }

  const trips = deleted.data ?? []
  if (trips.length === 0) {
    return (
      <Card className="p-5">
        <EmptyState
          title="Nothing in the bin"
          description={`Deleted trips wait here for ${SOFT_DELETE_GRACE_DAYS} days, with their itinerary and day notes, before they go for good.`}
          subtle
        />
      </Card>
    )
  }

  return (
    <Card className="divide-y divide-border p-0">
      {trips.map((trip) => {
        const left = daysLeft(trip.deleted_at)
        return (
          <div key={trip.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="font-medium">{trip.title}</p>
              <p className="text-sm text-muted-foreground">{formatTripDates(trip)}</p>
              <p
                className={
                  left <= 7
                    ? 'text-xs font-medium text-[hsl(var(--warn))]'
                    : 'text-xs text-muted-foreground'
                }
              >
                {left === 0 ? 'Goes for good today' : `Gone in ${pluralise(left, 'day')}`}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={restore.isPending}
              onClick={() => restore.mutate(trip.id)}
            >
              <RotateCcw aria-hidden="true" />
              Restore
            </Button>
          </div>
        )
      })}
    </Card>
  )
}
