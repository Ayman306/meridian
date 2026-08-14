/**
 * Find a place and take its coordinates.
 *
 * Used wherever something needs a location — the wishlist form today, more
 * later. It is here rather than in those modules because the Nominatim usage
 * policy is a single shared budget: one throttle, one cache, one component.
 */
'use client'

import { useState } from 'react'
import { MapPin, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { userMessage } from '@/lib/errors'
import type { PlaceResult } from '@/lib/geocode'
import { usePlaceSearch } from '../hooks'

export function PlaceSearch({
  onPick,
  placeholder = 'Search for a place',
  id,
}: {
  onPick: (place: PlaceResult) => void
  placeholder?: string
  id?: string
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const results = usePlaceSearch(query)

  const hits = results.data ?? []

  return (
    <div className="relative">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          id={id}
          value={query}
          className="pl-9"
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-expanded={open && hits.length > 0}
          aria-autocomplete="list"
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          // A blur that closes instantly beats the click on a result, so give
          // the click a frame to land.
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onFocus={() => setOpen(true)}
        />
      </div>

      {results.isError && (
        <p className="mt-1 text-xs text-muted-foreground">
          {/* Nominatim rate limits happen. Typing the place by hand still works. */}
          {userMessage(results.error)} You can fill the fields in by hand.
        </p>
      )}

      {open && hits.length > 0 && (
        <ul className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-popover p-1 shadow-lg">
          {hits.map((hit) => (
            <li key={`${hit.lat},${hit.lng},${hit.displayName}`}>
              <button
                type="button"
                className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-secondary"
                onClick={() => {
                  onPick(hit)
                  setQuery('')
                  setOpen(false)
                }}
              >
                <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span>
                  <span className="font-medium">{hit.name}</span>
                  <span className="block text-xs text-muted-foreground">{hit.displayName}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {results.isFetching && (
        <p className="mt-1 text-xs text-muted-foreground" role="status">
          Searching…
        </p>
      )}
    </div>
  )
}

export type { PlaceResult }
