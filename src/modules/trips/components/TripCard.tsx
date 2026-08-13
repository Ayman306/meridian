import { Link } from 'react-router-dom'
import { Card, Badge } from '@/components/ui/card'
import { useCouple } from '@/providers/CoupleProvider'
import { pluralise } from '@/lib/utils'
import { todayIn } from '@/lib/dates'
import { countdownDays, formatTripDates, isLongStay, nights, togetherWindow } from '../logic'
import type { TripSummary } from '../types'

export function TripCard({ trip }: { trip: TripSummary }) {
  const { tzSelf } = useCouple()
  const n = nights(trip)
  const countdown = countdownDays(trip, todayIn(tzSelf))
  const together = togetherWindow(trip, trip.travelers)

  return (
    <Card className="transition-colors hover:border-foreground/25">
      <Link to={`/trips/${trip.id}`} className="block rounded-lg p-5">
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
