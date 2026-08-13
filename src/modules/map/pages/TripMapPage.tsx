/**
 * One trip, spatially. Read-mostly: the plan is edited on the plan tab, and
 * the map's job is to show you that Tuesday has you crossing the city twice.
 */
'use client'

import { useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { MapPinOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input, Select } from '@/components/ui/input'
import { EmptyState, ErrorState, Skeleton } from '@/components/common/states'
import { formatInZone, parseDateOnly } from '@/lib/dates'
import { pluralise } from '@/lib/utils'
import { useCategories, useCreateItem, useMoveItem } from '@/modules/itinerary'
import { useTrip } from '@/modules/trips'
import { MapControls } from '../components/MapControls'
import { useMapData, usePinPeople } from '../hooks'
import {
  DEFAULT_FILTERS,
  applyFilters,
  dayRoute,
  daysWithPins,
  fallbackCenter,
  formatDistance,
  routeDistanceKm,
} from '../logic'
import type { MapFilters, MapPin } from '../types'

const MapCanvas = dynamic(() => import('../components/MapCanvas').then((m) => m.MapCanvas), {
  ssr: false,
  loading: () => <Skeleton className="h-[60vh] w-full rounded-lg" />,
})

export function TripMapPage({ tripId }: { tripId: string }) {
  const data = useMapData(tripId)
  const { data: trip } = useTrip(tripId)
  const categories = useCategories()
  const { people, colorFor, nameFor } = usePinPeople()
  const move = useMoveItem(tripId)
  const create = useCreateItem(tripId)

  const [filters, setFilters] = useState<MapFilters>(DEFAULT_FILTERS)
  const [selected, setSelected] = useState<MapPin | null>(null)
  const [dropped, setDropped] = useState<{ lat: number; lng: number } | null>(null)
  const [droppedTitle, setDroppedTitle] = useState('')
  // Changing this remounts the canvas, which is how "recentre" re-fits bounds
  // after the user has panned away.
  const [canvasKey, setCanvasKey] = useState(0)

  const pins = useMemo(() => data.data?.pins ?? [], [data.data])
  const visible = useMemo(() => applyFilters(pins, filters), [pins, filters])
  const route = useMemo(() => dayRoute(visible, filters.day), [visible, filters.day])
  const days = useMemo(() => daysWithPins(pins), [pins])
  const notOnMap = data.data?.notOnMap ?? []

  if (data.isLoading) return <Skeleton className="h-[60vh] w-full rounded-lg" />
  if (data.error) return <ErrorState error={data.error} onRetry={() => void data.refetch()} />

  const scheduleTo = (date: string) => {
    if (!selected) return
    move.mutate({ id: selected.id, date, beforeKey: null, afterKey: null })
    setSelected(null)
  }

  return (
    <div className="space-y-4">
      <MapControls
        filters={filters}
        onChange={setFilters}
        days={days}
        people={people}
        categories={categories.data ?? []}
        states={[...new Set(pins.map((p) => p.state).filter((s): s is string => Boolean(s)))]}
        availableLayers={['itinerary', 'pool']}
        onRecenter={() => setCanvasKey((n) => n + 1)}
      />

      {pins.length === 0 ? (
        <EmptyState
          icon={<MapPinOff className="size-5" aria-hidden="true" />}
          title="Nothing on the map yet"
          description="Places appear here as soon as an item on the plan has coordinates."
          action={
            <Link
              href={`/trips/${tripId}/plan`}
              className="text-sm font-medium underline underline-offset-4"
            >
              Open the plan
            </Link>
          }
        />
      ) : (
        <MapCanvas
          key={canvasKey}
          pins={visible}
          route={route}
          center={fallbackCenter(null)}
          colorFor={colorFor}
          nameFor={nameFor}
          onSelect={setSelected}
          onPickLocation={(at) => {
            setDropped(at)
            setSelected(null)
          }}
          className="h-[60vh] w-full overflow-hidden rounded-lg border border-border"
        />
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>{pluralise(visible.length, 'place')} shown</span>
        {route.length > 1 && (
          <span>
            {formatDistance(routeDistanceKm(route))} across the day — straight lines, not walking
            distance
          </span>
        )}
        {notOnMap.length > 0 && (
          <Link href={`/trips/${tripId}/plan`} className="underline underline-offset-4">
            Not on map ({notOnMap.length}) — add locations
          </Link>
        )}
      </div>

      {selected && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 py-4">
            <div className="mr-auto">
              <p className="font-medium">{selected.title}</p>
              <p className="text-xs text-muted-foreground">
                {selected.date
                  ? formatInZone(parseDateOnly(selected.date), 'UTC', 'EEE d MMM')
                  : 'In the idea pool'}
                {nameFor(selected.personId) ? ` · ${nameFor(selected.personId)}` : ''}
              </p>
            </div>

            {(trip?.days ?? []).length > 0 && (
              <Select
                className="h-9 w-auto"
                aria-label={selected.date ? 'Move to another day' : 'Schedule this idea'}
                value=""
                onChange={(e) => e.target.value && scheduleTo(e.target.value)}
              >
                <option value="">{selected.date ? 'Move to…' : 'Schedule for…'}</option>
                {(trip?.days ?? []).map((day) => (
                  <option key={day.date} value={day.date}>
                    {formatInZone(parseDateOnly(day.date), 'UTC', 'EEE d MMM')}
                  </option>
                ))}
              </Select>
            )}

            <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
              Close
            </Button>
          </CardContent>
        </Card>
      )}

      {dropped && (
        <Card>
          <CardContent className="space-y-3 py-4">
            <p className="text-sm">
              Add something here — {dropped.lat.toFixed(4)}, {dropped.lng.toFixed(4)}
            </p>
            <div className="flex flex-wrap gap-2">
              <Input
                autoFocus
                value={droppedTitle}
                placeholder="What is it?"
                className="w-56"
                onChange={(e) => setDroppedTitle(e.target.value)}
              />
              <Button
                disabled={!droppedTitle.trim() || create.isPending}
                onClick={() => {
                  create.mutate(
                    { title: droppedTitle.trim(), lat: dropped.lat, lng: dropped.lng },
                    {
                      onSuccess: () => {
                        setDropped(null)
                        setDroppedTitle('')
                      },
                    },
                  )
                }}
              >
                Add to the pool
              </Button>
              <Button variant="ghost" onClick={() => setDropped(null)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
