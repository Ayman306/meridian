/**
 * How far apart the two of you actually are.
 *
 * This is what stands where the pickup card would be when there is no pickup
 * to plan — which, for a couple in two countries, is most flights. The old
 * behaviour was to plan one anyway: `estimateDriveMinutes` answered every
 * distance, so a watcher 11,000 km from the arrival airport was told to set
 * off after a "20666 min" drive.
 *
 * The distance is still the interesting fact, so it is the one shown. Saying
 * it in hours of flying and months of walking is not decoration — a number in
 * kilometres is abstract, and "four months on foot" is not.
 */
'use client'

import { Bike, Footprints, Car, Plane } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { humaniseMinutes } from '@/lib/dates'
import { travelTimes, type TravelMode } from '../handoff'

const ICONS: Record<TravelMode, typeof Plane> = {
  plane: Plane,
  car: Car,
  bike: Bike,
  walk: Footprints,
}

export function DistanceCard({
  km,
  travelerName,
  className,
}: {
  km: number
  travelerName: string
  className?: string
}) {
  const estimates = travelTimes(km)
  if (estimates.length === 0) return null

  return (
    <Card className={className}>
      <CardContent className="space-y-4 py-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="tabular text-3xl font-semibold">
            {Math.round(km).toLocaleString()} km
          </span>
          <span className="text-sm text-muted-foreground">
            between you and where {travelerName} lands
          </span>
        </div>

        <ul className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {estimates.map((estimate) => {
            const Icon = ICONS[estimate.mode]
            return (
              <li key={estimate.mode} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Icon className="size-4" aria-hidden="true" />
                  {estimate.label}
                </span>
                <span className="tabular">{humaniseMinutes(estimate.minutes)}</span>
              </li>
            )
          })}
        </ul>

        <p className="text-xs text-muted-foreground">
          Too far to drive over, so there is no pickup to plan. Straight-line distance — the
          walking figure assumes you never stop, which would be a choice.
        </p>
      </CardContent>
    </Card>
  )
}
