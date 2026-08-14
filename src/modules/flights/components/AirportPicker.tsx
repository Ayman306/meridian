/**
 * Pick an airport by code, city or name.
 *
 * This exists because manual entry is the baseline for this module, and the
 * baseline could not name an airport. With no AeroDataBox key configured —
 * the documented, supported state — every flight saved with a null route,
 * rendered as `??? → ???`, drew no great circle and could not compute a
 * meeting time. A flight number without endpoints is not a flight.
 *
 * Typing "DXB", "Dubai" or "Dubai International" finds the same row, because
 * people hold all three in their head and a booking email shows whichever it
 * feels like. An exact code match always sorts first.
 *
 * A code that is not in the table is still accepted. The seed is about 135
 * airports, not nine thousand; an unlisted one saves fine and simply carries
 * no coordinates until somebody adds the row — which degrades the map, not the
 * flight.
 */
'use client'

import { useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, Plane } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { searchAirports } from '../api'
import type { AirportRow } from '../types'

export function AirportPicker({
  label,
  value,
  onChange,
  id,
  hint,
  className,
}: {
  label: string
  /** The IATA code, or '' when nothing is chosen yet. */
  value: string
  /** Called with the code, and the full row when it is one we know. */
  onChange: (iata: string, airport: AirportRow | null) => void
  id?: string
  hint?: string
  className?: string
}) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const listId = `${inputId}-list`

  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const blurTimer = useRef<number | null>(null)

  const results = useQuery({
    queryKey: ['airport-search', query] as const,
    queryFn: () => searchAirports(query),
    enabled: open && query.trim().length > 0,
    // The table changes by migration, so a result set is good indefinitely.
    staleTime: 60 * 60_000,
  })

  // What the chosen code actually is, so the field can show "DXB — Dubai"
  // rather than four letters the user has to remember the meaning of.
  const chosen = useQuery({
    queryKey: ['airport', value] as const,
    queryFn: () => searchAirports(value).then((rows) => rows.find((r) => r.iata === value) ?? null),
    enabled: value.length === 3,
    staleTime: 60 * 60_000,
  })

  const commit = (iata: string, airport: AirportRow | null) => {
    onChange(iata, airport)
    setQuery('')
    setOpen(false)
  }

  return (
    <div className={cn('relative space-y-1', className)}>
      <label htmlFor={inputId} className="text-sm font-medium">
        {label}
      </label>
      <Input
        id={inputId}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder="DXB, Dubai…"
        maxLength={open ? undefined : 3}
        value={open ? query : value}
        onFocus={() => {
          setQuery('')
          setOpen(true)
        }}
        onBlur={() => {
          blurTimer.current = window.setTimeout(() => setOpen(false), 120)
        }}
        onChange={(e) => {
          const next = e.target.value
          setQuery(next)
          setOpen(true)
          // Typing three letters that look like a code commits them straight
          // away, so an airport we do not have a row for still saves.
          if (/^[A-Za-z]{3}$/.test(next.trim())) {
            onChange(next.trim().toUpperCase(), null)
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false)
          if (e.key === 'Enter' && open && results.data?.[0]) {
            e.preventDefault()
            commit(results.data[0].iata, results.data[0])
          }
        }}
      />

      {!open && chosen.data ? (
        <p className="text-xs text-muted-foreground">
          {chosen.data.city} — {chosen.data.name}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}

      {!open && value.length === 3 && !chosen.data && !chosen.isLoading && (
        <p className="text-xs text-muted-foreground">
          Not in our list — it saves, but the map will not draw this leg.
        </p>
      )}

      {open && (query.trim().length > 0) && (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-background shadow-lg"
        >
          {results.isLoading && (
            <li className="px-3 py-2 text-sm text-muted-foreground">Searching…</li>
          )}
          {results.data?.length === 0 && (
            <li className="px-3 py-2 text-sm text-muted-foreground">
              Nothing matches. A three-letter code still works.
            </li>
          )}
          {results.data?.map((airport) => (
            <li key={airport.iata}>
              <button
                type="button"
                role="option"
                aria-selected={airport.iata === value}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-secondary"
                onMouseDown={() => {
                  if (blurTimer.current) window.clearTimeout(blurTimer.current)
                  commit(airport.iata, airport)
                }}
              >
                <Plane className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="w-10 shrink-0 font-medium tabular-nums">{airport.iata}</span>
                <span className="min-w-0 flex-1 truncate">
                  {airport.city}
                  <span className="ml-1 text-muted-foreground">{airport.name}</span>
                </span>
                {airport.iata === value && (
                  <Check className="size-4 shrink-0 text-accent" aria-hidden="true" />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
