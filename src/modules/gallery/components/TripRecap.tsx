/**
 * What a trip looked like, afterwards.
 *
 * `buildRecap` has been written and tested since Phase 11 and rendered
 * nowhere, which is the worst state for a feature to be in: the arithmetic was
 * maintained, the value was zero.
 *
 * Two honesty notes it carries on screen, because both numbers invite a
 * stronger reading than they deserve:
 *
 *   - The distance is between consecutive *photo* locations. It is a lower
 *     bound on how far they moved, not a claim about it — you only get a point
 *     where somebody took a picture, and a day nobody photographed is a
 *     straight line through it.
 *   - Photos without coordinates are counted separately rather than folded in,
 *     so "42 photos, 30 with a location" cannot be misread as "42 places".
 */
'use client'

import { Download, MapPin, Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatDistance } from '@/modules/map'
import { pluralise } from '@/lib/utils'
import { buildRecap } from '../logic'
import type { Media } from '../types'

export function TripRecap({
  media,
  distanceUnit = 'km',
  onDownloadAll,
  downloading,
}: {
  media: readonly Media[]
  distanceUnit?: 'km' | 'mi'
  onDownloadAll?: () => void
  /** How many of the batch are done, or null when nothing is running. */
  downloading?: { done: number; total: number } | null
}) {
  const recap = buildRecap(media)
  if (recap.count === 0) return null

  const missing = recap.count - recap.withLocation

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">The trip, afterwards</h2>
        {onDownloadAll && (
          <Button
            size="sm"
            variant="outline"
            disabled={Boolean(downloading)}
            onClick={onDownloadAll}
          >
            <Download aria-hidden="true" />
            {downloading
              ? `Downloading ${downloading.done} of ${downloading.total}…`
              : `Download all ${recap.count}`}
          </Button>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Photos" value={String(recap.count)} />
        <Stat
          label="Favourites"
          value={String(recap.favourites)}
          icon={<Star className="size-3" aria-hidden="true" />}
        />
        <Stat
          label="On the map"
          value={String(recap.withLocation)}
          icon={<MapPin className="size-3" aria-hidden="true" />}
        />
        <Stat
          label="At least"
          value={recap.distanceKm > 0 ? formatDistance(recap.distanceKm, distanceUnit) : '—'}
        />
      </dl>

      <p className="text-xs text-muted-foreground">
        The distance is measured between consecutive photo locations, so it is the least you
        travelled rather than the most — a stretch nobody photographed is a straight line through
        it.
        {missing > 0 && ` ${pluralise(missing, 'photo')} carried no location at all.`}
      </p>
    </Card>
  )
}

function Stat({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div>
      <dt className="flex items-center gap-1 text-xs text-muted-foreground">
        {icon}
        {label}
      </dt>
      <dd className="tabular-nums text-xl font-semibold">{value}</dd>
    </div>
  )
}
