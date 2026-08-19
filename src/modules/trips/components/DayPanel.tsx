/**
 * One day of the trip, in the space a card can hold.
 *
 * The panel is the detail half of the journey view: the strip above says which
 * days matter, this says what is on the one you tapped. It has a ceiling and
 * scrolls inside it, so tapping through fourteen days never moves the strip or
 * the map — the page itself does not grow.
 *
 * Non-negotiable #6 lives here. On a long stay an empty day is the point of the
 * trip, so it gets `RestfulEmpty` and nothing else — no suggestions, no button,
 * nothing that reads as a gap to fill.
 */
'use client'

import { BedDouble, LogOut, Plane, PlaneLanding, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/card'
import { RestfulEmpty } from '@/components/common/states'
import { formatDateOnly, formatTime } from '@/lib/dates'
import { cn } from '@/lib/utils'
import type { JourneyDay } from '../journey'

export interface NearbyPlace {
  id: string
  title: string
  km: number
}

export interface DayPanelProps {
  day: JourneyDay
  /** Blank days are restful rather than empty once the stay is long. */
  restful: boolean
  /** A line about the signed-in person's own cycle. Never the partner's. */
  cycleNote: string | null
  nearby: NearbyPlace[]
  onAddNearby: (id: string) => void
  addingId: string | null
}

export function DayPanel({
  day,
  restful,
  cycleNote,
  nearby,
  onAddNearby,
  addingId,
}: DayPanelProps) {
  const blank = day.entries.length === 0

  return (
    <section
      aria-label={`Day ${day.index}, ${formatDateOnly(day.date, 'EEEE d MMMM')}`}
      className="flex max-h-72 min-h-40 flex-col gap-3 overflow-y-auto rounded-lg border border-border p-3"
    >
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">
          Day {day.index} · {formatDateOnly(day.date, 'EEE d MMM')}
        </h2>
        {day.place && <Badge tone="accent">{day.place}</Badge>}
        {day.title && <span className="text-sm text-muted-foreground">{day.title}</span>}
      </header>

      {/* Where they sleep, and what they have to be out of. Both, because the
          check-out morning carries both facts and picking one loses the other:
          leaving the Alfama at 11 and moving into the Baixa that night is one
          day and two bookings. */}
      {(day.stay || day.checkingOutOf) && (
        <div className="space-y-1 text-xs">
          {day.checkingOutOf && day.checkingOutOf.id !== day.stay?.id && (
            <p className="flex items-center gap-1.5 text-muted-foreground">
              <LogOut className="size-3 shrink-0" aria-hidden="true" />
              Check out of {day.checkingOutOf.name}
            </p>
          )}
          {day.stay && (
            <p className="flex items-start gap-1.5">
              <BedDouble className="mt-0.5 size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span>
                {day.stay.name}
                {day.stay.address && (
                  <span className="block text-muted-foreground">{day.stay.address}</span>
                )}
              </span>
            </p>
          )}
        </div>
      )}

      {cycleNote && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="size-1.5 shrink-0 rounded-full bg-rose-500/80" aria-hidden="true" />
          {cycleNote}
        </p>
      )}

      {day.note && <p className="text-sm text-muted-foreground">{day.note}</p>}

      {blank ? (
        restful ? (
          <RestfulEmpty label="Open" />
        ) : (
          <p className="py-2 text-sm text-muted-foreground">Nothing planned yet.</p>
        )
      ) : (
        <ul className="space-y-1.5">
          {day.entries.map((entry) => (
            <li key={entry.id} className="flex items-baseline gap-2 text-sm">
              {entry.kind === 'item' ? (
                <>
                  <span className="tabular w-11 shrink-0 text-xs text-muted-foreground">
                    {formatTime(entry.time) ?? ''}
                  </span>
                  <span className={cn(entry.state === 'skipped' && 'line-through opacity-60')}>
                    {entry.title}
                    {entry.placeName && entry.placeName !== entry.title && (
                      <span className="text-muted-foreground"> · {entry.placeName}</span>
                    )}
                  </span>
                </>
              ) : (
                <>
                  <span className="w-11 shrink-0 text-xs text-muted-foreground">
                    {entry.kind === 'arrive' ? (
                      <PlaneLanding className="size-3.5" aria-hidden="true" />
                    ) : (
                      <Plane className="size-3.5" aria-hidden="true" />
                    )}
                  </span>
                  <span>
                    {entry.kind === 'arrive' ? 'Lands' : 'Departs'}
                    {entry.airport ? ` ${entry.airport}` : ''}
                    <span className="text-muted-foreground"> · {entry.flightNumber}</span>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Saved places they already chose, near where they already are. Held
          back on a restful day, where an invitation to fill it would undo the
          whole point of leaving it blank. */}
      {!restful && nearby.length > 0 && (
        <div className="mt-auto space-y-1.5 border-t border-border pt-2">
          <p className="text-xs text-muted-foreground">
            {day.stay ? `From your saved places, near ${day.stay.name}` : 'From your saved places, nearby'}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {nearby.map((place) => (
              <button
                key={place.id}
                onClick={() => onAddNearby(place.id)}
                disabled={addingId !== null}
                className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs hover:bg-secondary disabled:opacity-50"
              >
                <Plus className="size-3" aria-hidden="true" />
                {place.title}
                <span className="text-muted-foreground">{formatKm(place.km)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

/**
 * Distance, rounded to what somebody would actually say out loud. Under a
 * kilometre reads as "nearby" rather than as 400 m, because the precision is
 * beside the point when the answer is "you can walk it".
 */
function formatKm(km: number): string {
  if (km < 1) return 'nearby'
  return `${Math.round(km)} km`
}
