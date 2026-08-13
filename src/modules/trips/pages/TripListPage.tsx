'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { buttonVariants } from '@/components/ui/button'
import { EmptyState, ErrorState, SkeletonList } from '@/components/common/states'
import { useCouple } from '@/providers/CoupleProvider'
import { todayIn } from '@/lib/dates'
import { useTrips } from '../hooks'
import { GROUP_LABELS, groupTrips } from '../logic'
import { TripCard } from '../components/TripCard'
import type { TripGroup } from '../types'

const ORDER: TripGroup[] = ['active', 'upcoming', 'planning', 'past']

export function TripListPage() {
  const { tzSelf } = useCouple()
  const { data, isLoading, error, refetch } = useTrips()

  const today = todayIn(tzSelf)
  const groups = useMemo(() => groupTrips(data ?? [], today), [data, today])

  return (
    <>
      <PageHeader
        title="Trips"
        actions={
          <Link href="/trips/new" className={buttonVariants()}>
            <Plus aria-hidden="true" />
            New trip
          </Link>
        }
      />

      {isLoading && <SkeletonList rows={3} />}

      {error && <ErrorState error={error} onRetry={() => void refetch()} />}

      {!isLoading && !error && (data?.length ?? 0) === 0 && (
        <EmptyState
          title="No trips yet"
          description="A trip needs nothing but a name. Add one and fill in the rest whenever you know it."
          action={
            <Link href="/trips/new" className={buttonVariants()}>
              Start a trip
            </Link>
          }
        />
      )}

      <div className="space-y-8">
        {ORDER.map((group) =>
          groups[group].length > 0 ? (
            <section key={group}>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {GROUP_LABELS[group]}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {groups[group].map((trip) => (
                  <TripCard key={trip.id} trip={trip} />
                ))}
              </div>
            </section>
          ) : null,
        )}
      </div>
    </>
  )
}
