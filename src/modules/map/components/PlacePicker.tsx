/**
 * One pin on a small map, with the option to move it.
 *
 * Shown after a place has been located — by a pasted link, a name search, or a
 * previous save — so somebody can *see* where it landed before committing it.
 * That check matters more than it sounds: a Google Maps link copied after
 * panning carries the camera position rather than the pin, so the coordinates
 * can be a street off while the name and address look perfectly right. A map
 * makes that obvious in a way a pair of decimal numbers never will.
 *
 * Long-press (or right-click) moves the pin, which is the correction path for
 * exactly that case. Moving it clears the address, because an address that
 * belonged to the old coordinates is now a claim about somewhere else — the
 * caller re-derives it.
 */
'use client'

import { useMemo } from 'react'
import { MapPin as PinIcon, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { MapCanvas } from './MapCanvas'
import type { MapPin } from '../types'

export interface PlacePickerProps {
  lat: number | null
  lng: number | null
  /** Shown on the pin and in the summary line. */
  title: string
  address?: string | null
  /** A caveat about how the coordinates were derived, when there is one. */
  note?: string | null
  /** Long-press moves the pin. Omit to make the map read-only. */
  onMove?: (at: { lat: number; lng: number }) => void
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
  onClear,
  className,
}: PlacePickerProps) {
  const pins = useMemo<MapPin[]>(() => {
    if (lat === null || lng === null) return []
    return [
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
  }, [lat, lng, title, address])

  if (lat === null || lng === null) return null

  return (
    <div className={cn('space-y-2', className)}>
      <MapCanvas
        pins={pins}
        route={[]}
        center={{ lat, lng }}
        // One pin, no ownership to distinguish, so the usual per-person colour
        // scheme has nothing to say here.
        colorFor={() => 'var(--pin-neutral, #f59e0b)'}
        nameFor={() => title || 'This place'}
        onPickLocation={onMove}
        className="h-48 w-full overflow-hidden rounded-lg border border-border"
      />

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <PinIcon className="size-3 shrink-0" aria-hidden="true" />
            <span className="truncate">
              {address ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`}
            </span>
          </p>
          {note && <p className="text-xs text-muted-foreground">{note}</p>}
          {onMove && (
            <p className="text-xs text-muted-foreground">
              Long-press the map to move the pin if it is not quite right.
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
