/**
 * Everywhere, across every trip and the whole wishlist.
 *
 * The trip map answers "what am I doing on Tuesday". This one answers "where
 * have we been, and where do we keep meaning to go" — so the wishlist layer is
 * on by default here and absent there.
 */
'use client'

import { useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { MapPinOff } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState, ErrorState, Skeleton } from '@/components/common/states'
import { pluralise } from '@/lib/utils'
import { useCategories } from '@/modules/itinerary'
import { MapControls } from '../components/MapControls'
import { useMapData, usePinPeople } from '../hooks'
import { DEFAULT_FILTERS, applyFilters, fallbackCenter } from '../logic'
import type { MapFilters } from '../types'

const MapCanvas = dynamic(() => import('../components/MapCanvas').then((m) => m.MapCanvas), {
  ssr: false,
  loading: () => <Skeleton className="h-[65vh] w-full rounded-lg" />,
})

export function AllMapPage() {
  const data = useMapData(null)
  const categories = useCategories()
  const { people, colorFor, nameFor } = usePinPeople()

  const [filters, setFilters] = useState<MapFilters>(DEFAULT_FILTERS)
  const [canvasKey, setCanvasKey] = useState(0)

  const pins = useMemo(() => data.data?.pins ?? [], [data.data])
  const visible = useMemo(() => applyFilters(pins, filters), [pins, filters])
  const notOnMap = data.data?.notOnMap ?? []

  return (
    <div className="space-y-4">
      <PageHeader
        title="Everywhere"
        description="Every place with coordinates, across all your trips and saves."
      />

      {data.isLoading ? (
        <Skeleton className="h-[65vh] w-full rounded-lg" />
      ) : data.error ? (
        <ErrorState error={data.error} onRetry={() => void data.refetch()} />
      ) : (
        <>
          <MapControls
            filters={filters}
            onChange={setFilters}
            // No day filter here: days from different trips would collide, and
            // "Tuesday" across four trips is not a question anyone asks.
            days={[]}
            people={people}
            categories={categories.data ?? []}
            states={[...new Set(pins.map((p) => p.state).filter((s): s is string => Boolean(s)))]}
            availableLayers={['itinerary', 'pool', 'wishlist']}
            onRecenter={() => setCanvasKey((n) => n + 1)}
          />

          {pins.length === 0 ? (
            <EmptyState
              icon={<MapPinOff className="size-5" aria-hidden="true" />}
              title="No coordinates yet"
              description="Save a place with a location and it lands here."
              action={
                <Link
                  href="/wishlist"
                  className="text-sm font-medium underline underline-offset-4"
                >
                  Open the wishlist
                </Link>
              }
            />
          ) : (
            <MapCanvas
              key={canvasKey}
              pins={visible}
              route={[]}
              center={fallbackCenter(null)}
              colorFor={colorFor}
              nameFor={nameFor}
              className="h-[65vh] w-full overflow-hidden rounded-lg border border-border"
            />
          )}

          <p className="text-xs text-muted-foreground">
            {pluralise(visible.length, 'place')} shown
            {notOnMap.length > 0 && ` · ${notOnMap.length} without coordinates`}
          </p>
        </>
      )}
    </div>
  )
}
