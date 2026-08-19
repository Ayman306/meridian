/**
 * Where a place is, shown as a map and an address — never as numbers.
 *
 * Two rules drive the whole component.
 *
 * **Nobody types coordinates, and nobody is shown them.** Latitude and
 * longitude are machine facts. A person who reads "12.86980, 74.84300" has
 * learned nothing they can check, and a person asked to *enter* that has been
 * handed the app's job. So the only inputs here are a map you can press, a
 * search box, and the phone's own location; and the only output is a street
 * address.
 *
 * **A pin that moves gets a new address, immediately.** The address is derived
 * from the coordinates, so leaving an old one attached to a new pin turns a
 * description of one place into a false claim about another. The lookup lives
 * inside this component rather than in each form precisely so no caller can
 * forget it — an earlier version left that to the forms, promised in the UI
 * that it would happen on save, and never did it.
 */
'use client'

import { useEffect, useRef, useState } from 'react'
import { Crosshair, ExternalLink, Loader2, MapPin as PinIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { PlaceResult } from '@/lib/geocode'
import { MapCanvas } from './MapCanvas'
import { useReverseGeocode } from '../hooks'
import type { MapPin } from '../types'

export interface PlacePickerProps {
  lat: number | null
  lng: number | null
  title: string
  address?: string | null
  /** A caveat about how the coordinates were derived, when there is one. */
  note?: string | null
  /** Long-press moves the pin. Omit to make the map read-only. */
  onMove?: (at: { lat: number; lng: number }) => void
  /**
   * Called when an address has been worked out for coordinates that had none.
   * This is how the form gets a value it never asks anybody to type.
   */
  onAddressResolved?: (place: PlaceResult) => void
  onClear?: () => void
  className?: string
}

export function PlacePicker({
  lat,
  lng,
  title,
  address,
  note,
  onMove,
  onAddressResolved,
  onClear,
  className,
}: PlacePickerProps) {
  // Only asked for when there is a pin and no address to describe it.
  const needsAddress = lat !== null && lng !== null && !address
  const lookup = useReverseGeocode(needsAddress ? lat : null, needsAddress ? lng : null)

  // Handed back through a ref so a form re-rendering on every keystroke cannot
  // retrigger the effect and loop.
  const report = useRef(onAddressResolved)
  useEffect(() => {
    report.current = onAddressResolved
  })

  useEffect(() => {
    if (lookup.data) report.current?.(lookup.data)
  }, [lookup.data])

  if (lat === null || lng === null) return null

  const pins: MapPin[] = [
    {
      id: 'picked',
      layer: 'wishlist',
      title: title || 'This place',
      lat,
      lng,
      date: null,
      time: null,
      categoryId: null,
      personId: null,
      state: null,
      placeName: title || null,
      address: address ?? null,
    } as MapPin,
  ]

  return (
    <div className={cn('space-y-2', className)}>
      <MapCanvas
        pins={pins}
        route={[]}
        center={{ lat, lng }}
        // One pin, no ownership to distinguish, so the per-person colour scheme
        // has nothing to say here.
        colorFor={() => 'var(--pin-neutral, #f59e0b)'}
        nameFor={() => title || 'This place'}
        onPickLocation={onMove}
        className="h-48 w-full overflow-hidden rounded-lg border border-border"
      />

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <PinIcon className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
            <AddressLine
              address={address}
              resolving={lookup.isFetching}
              failed={lookup.isFetched && !lookup.data}
            />
          </p>
          {note && <p className="text-xs text-muted-foreground">{note}</p>}
          {onMove && (
            <p className="text-xs text-muted-foreground">
              Not quite right? Press and hold the map to move the pin.
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <ExternalLink className="size-3" aria-hidden="true" />
            Open
          </a>
          {onClear && (
            <Button variant="ghost" size="sm" onClick={onClear}>
              Clear
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * What the pin is, in words.
 *
 * The failure branch says the place has no address rather than printing the
 * coordinates instead. "Somewhere with no street address" is a true and useful
 * sentence; a pair of decimals is neither.
 */
function AddressLine({
  address,
  resolving,
  failed,
}: {
  address: string | null | undefined
  resolving: boolean
  failed: boolean
}) {
  if (address) return <span className="min-w-0">{address}</span>
  if (resolving) {
    return (
      <span className="inline-flex items-center gap-1">
        <Loader2 className="size-3 animate-spin" aria-hidden="true" />
        Finding the address…
      </span>
    )
  }
  if (failed) return <span>Pinned. There is no street address at this spot.</span>
  return <span>Pinned.</span>
}

/**
 * "I am standing here."
 *
 * The most dynamic source there is, and the only one that needs no typing at
 * all. Kept separate from `PlacePicker` because it is offered *before* there is
 * a pin, and the picker has nothing to draw until there is one.
 */
export function UseMyLocationButton({
  onLocated,
  className,
}: {
  onLocated: (at: { lat: number; lng: number }) => void
  className?: string
}) {
  const [state, setState] = useState<'idle' | 'locating' | 'denied' | 'unavailable'>('idle')

  if (typeof navigator !== 'undefined' && !('geolocation' in navigator)) return null

  return (
    <div className={className}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={state === 'locating'}
        onClick={() => {
          setState('locating')
          navigator.geolocation.getCurrentPosition(
            (position) => {
              setState('idle')
              onLocated({
                lat: position.coords.latitude,
                lng: position.coords.longitude,
              })
            },
            (error) => {
              // Permission denied cannot be retried from script — the browser
              // has to be reset by the person — so it is reported as a state
              // rather than as something to press again.
              setState(error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable')
            },
            { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
          )
        }}
      >
        {state === 'locating' ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <Crosshair aria-hidden="true" />
        )}
        {state === 'locating' ? 'Finding you…' : 'Use my location'}
      </Button>

      {state === 'denied' && (
        <p className="pt-1 text-xs text-muted-foreground">
          Location is blocked for this site. Only you can undo that, in your browser&rsquo;s
          settings.
        </p>
      )}
      {state === 'unavailable' && (
        <p className="pt-1 text-xs text-muted-foreground">
          Could not get a location just now. Search for the place instead.
        </p>
      )}
    </div>
  )
}
