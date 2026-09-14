'use client'

import Link from 'next/link'
import { CalendarClock } from 'lucide-react'
import { Card, Badge } from '@/components/ui/card'
import { useCouple } from '@/providers/CoupleProvider'
import { pluralise } from '@/lib/utils'
import { todayIn } from '@/lib/dates'
import { countdownDays, formatTripDates, isLongStay, nights, togetherWindow } from '../logic'
import type { TripSummary } from '../types'

export function TripCard({
  trip,
  clashesWith = [],
}: {
  trip: TripSummary
  /** Other trips covering the same days. `overlappingTrips` has been computed
      since Phase 2 and shown nowhere, so two trips could quietly be booked
      over each other. */
  clashesWith?: readonly TripSummary[]
}) {
  const { tzSelf } = useCouple()
  const n = nights(trip)
  const countdown = countdownDays(trip, todayIn(tzSelf))
  const together = togetherWindow(trip, trip.travelers)

  return (
    <Card className="transition-colors hover:border-foreground/25">
      <Link href={`/trips/${trip.id}`} className="block rounded-lg p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h3 className="truncate font-semibold">{trip.title}</h3>
            <p className="text-sm text-muted-foreground">{formatTripDates(trip)}</p>
          </div>
          {trip.status && <Badge tone={badgeTone(trip.status.name)}>{trip.status.name}</Badge>}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {n !== null && (
            <span>
              {pluralise(n, 'night')}
              {isLongStay(trip) && <span className="ml-1.5 text-xs">· long stay</span>}
            </span>
          )}
          {countdown !== null && (
            <span className="tabular font-medium text-foreground">
              {countdown === 0 ? 'Today' : `in ${pluralise(countdown, 'day')}`}
            </span>
          )}
          {!together.incomplete &&
            (together.overlaps ? (
              together.nights > 0 && <span>{pluralise(together.nights, 'night')} together</span>
            ) : (
              <span className="text-[hsl(var(--warn))]">Your dates don&apos;t overlap</span>
            ))}
        </div>

        {/* Stated, not prevented. Two trips over the same days is usually a
            mistake and occasionally deliberate — a side trip inside a longer
            stay is a real thing — so this says what it sees and leaves the
            decision alone. */}
        {clashesWith.length > 0 && (
          <p className="mt-3 flex items-start gap-2 text-xs text-[hsl(var(--warn))]">
            <CalendarClock className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            <span>
              Same days as{' '}
              {clashesWith.length === 1
                ? clashesWith[0]!.title
                : `${clashesWith[0]!.title} and ${pluralise(clashesWith.length - 1, 'other')}`}
            </span>
          </p>
        )}
      </Link>
    </Card>
  )
}

function badgeTone(status: string): 'neutral' | 'ok' | 'warn' | 'accent' | 'danger' {
  switch (status) {
    case 'Active':
      return 'ok'
    case 'Booked':
      return 'accent'
    case 'Cancelled':
      return 'danger'
    case 'Completed':
      return 'neutral'
    default:
      return 'warn'
  }
}
