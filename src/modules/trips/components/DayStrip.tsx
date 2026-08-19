/**
 * The whole trip as one row of days.
 *
 * A vertical list of every day is the obvious way to show a trip and the wrong
 * one: a fortnight becomes a page nobody reads to the bottom of, and the shape
 * of the trip — where the flights are, where the empty stretch is — is the
 * first thing lost. A strip keeps the shape visible and costs one row.
 *
 * Each chip carries only what can be read without stopping: the date, and up to
 * three marks. Anything more belongs in the panel below, one tap away.
 */
'use client'

import { useEffect, useRef } from 'react'
import { BedDouble, Plane, Moon } from 'lucide-react'
import { formatDateOnly, type DateOnly } from '@/lib/dates'
import { cn } from '@/lib/utils'
import type { JourneyDay } from '../journey'

export interface DayStripProps {
  days: JourneyDay[]
  selected: DateOnly | null
  today: DateOnly
  onSelect: (date: DateOnly) => void
  /**
   * The signed-in person's own cycle, day by day, as a short phrase. Empty when
   * they do not track one.
   *
   * A phrase rather than a boolean because the dot has to be readable without
   * eyes: "period expected" and "period logged" are the same mark and not the
   * same fact, and a screen reader that only heard "day four" would be told
   * less than a sighted person is shown.
   */
  cycleDays?: ReadonlyMap<DateOnly, string>
}

export function DayStrip({ days, selected, today, onSelect, cycleDays }: DayStripProps) {
  const strip = useRef<HTMLDivElement>(null)

  // Bring the chosen day into view on first paint. Without this a trip that
  // opens on day nine looks like it opened on day one, since the selected chip
  // is off the right-hand edge.
  useEffect(() => {
    const chip = strip.current?.querySelector('[aria-selected="true"]')
    chip?.scrollIntoView({ block: 'nearest', inline: 'center' })
    // Deliberately mount-only: re-running it would yank the strip out from
    // under a finger that is mid-scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      ref={strip}
      role="tablist"
      aria-label="Days of this trip"
      className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {days.map((day) => {
        const isSelected = day.date === selected
        const planned = day.entries.filter((e) => e.kind === 'item').length
        return (
          <button
            key={day.date}
            role="tab"
            aria-selected={isSelected}
            aria-label={dayLabel(day, cycleDays?.get(day.date) ?? null)}
            onClick={() => onSelect(day.date)}
            className={cn(
              'flex w-14 shrink-0 flex-col items-center gap-0.5 rounded-lg border px-1 py-2 text-center transition-colors',
              isSelected
                ? 'border-foreground bg-secondary'
                : 'border-border hover:bg-secondary/60',
            )}
          >
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {formatDateOnly(day.date, 'EEE')}
            </span>
            <span
              className={cn(
                'tabular text-base font-semibold leading-none',
                day.date === today && 'text-accent-foreground underline underline-offset-4',
              )}
            >
              {formatDateOnly(day.date, 'd')}
            </span>

            {/* One row, fixed height whether or not there is anything in it, so
                the chips do not jitter in height along the strip. */}
            <span className="flex h-3 items-center gap-0.5" aria-hidden="true">
              {day.isTravel && <Plane className="size-3 text-muted-foreground" />}
              {/* Only when there is no plane already: a travel day with a bed is
                  still first a travel day, and three marks on a 56px chip is
                  where a glance turns into a puzzle. */}
              {!day.isTravel && day.stay && (
                <BedDouble className="size-3 text-muted-foreground/70" />
              )}
              {day.isRest && <Moon className="size-3 text-muted-foreground/70" />}
              {planned > 0 && <Dots count={planned} />}
              {/* Same rose as the cycle calendar, so the mark means the same
                  thing in both places without a legend. */}
              {cycleDays?.has(day.date) && <span className="size-1.5 rounded-full bg-rose-500/80" />}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** Everything the chip shows, said once, for anyone not looking at it. */
function dayLabel(day: JourneyDay, cycle: string | null): string {
  const parts = [`Day ${day.index}`, formatDateOnly(day.date, 'EEEE d MMMM')]
  if (day.isTravel) parts.push('travel day')
  if (day.isRest) parts.push('kept clear')
  // Spoken even when the icon was dropped for space — a screen reader has no
  // 56px limit.
  if (day.stay) parts.push(`staying at ${day.stay.name}`)
  if (day.checkingOutOf) parts.push(`checking out of ${day.checkingOutOf.name}`)
  const planned = day.entries.filter((e) => e.kind === 'item').length
  if (planned > 0) parts.push(`${planned} planned`)
  if (cycle) parts.push(cycle)
  return parts.join(', ')
}

/** Density at a glance. Past three it stops counting and says "lots". */
function Dots({ count }: { count: number }) {
  if (count > 3) {
    return <span className="tabular text-[10px] font-medium text-muted-foreground">{count}</span>
  }
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="size-1.5 rounded-full bg-foreground/60" />
      ))}
    </>
  )
}
