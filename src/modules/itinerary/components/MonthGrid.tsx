/**
 * The long-stay view. A month at a glance, where most cells are meant to be
 * blank — so a blank cell is styled as calm, never as a gap to be filled.
 */
import { useMemo } from 'react'
import { parseDateOnly, type DateOnly } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { dayDensity } from '../logic'
import type { ItineraryItem } from '../types'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const DAY_GLYPH: Record<string, string> = {
  travel: '✈',
  rest: '·',
  work: '▪',
  planned: '',
  open: '',
}

export function MonthGrid({
  days,
  itemsByDate,
  dayTypes,
  selected,
  onSelect,
}: {
  days: DateOnly[]
  itemsByDate: Record<string, ItineraryItem[]>
  dayTypes: Record<string, string>
  selected: DateOnly | null
  onSelect: (date: DateOnly) => void
}) {
  // Pad the first week so the grid lines up under the weekday headings.
  const leadingBlanks = useMemo(() => {
    if (days.length === 0) return 0
    const first = parseDateOnly(days[0]!).getDay() // 0 = Sunday
    return (first + 6) % 7 // shift to Monday-first
  }, [days])

  if (days.length === 0) return null

  return (
    <div>
      <div className="mb-1 grid grid-cols-7 gap-1">
        {WEEKDAYS.map((d) => (
          <div key={d} className="px-1 text-center text-[11px] font-medium text-muted-foreground">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: leadingBlanks }).map((_, i) => (
          <div key={`blank-${i}`} aria-hidden="true" />
        ))}

        {days.map((date) => {
          const items = itemsByDate[date] ?? []
          const density = dayDensity(items.length)
          const type = dayTypes[date] ?? 'open'
          const glyph = DAY_GLYPH[type] ?? ''

          return (
            <button
              key={date}
              onClick={() => onSelect(date)}
              aria-label={`${date}, ${items.length} items`}
              aria-current={selected === date ? 'date' : undefined}
              className={cn(
                'flex aspect-square flex-col items-center justify-center gap-1 rounded-md border text-sm transition-colors',
                selected === date
                  ? 'border-foreground bg-secondary'
                  : 'border-border hover:bg-secondary/60',
                // An open day is quiet, not empty-looking. No dashed border,
                // no "+" affordance, nothing that reads as a missing thing.
                density === 'none' && 'text-muted-foreground/70',
              )}
            >
              <span className="tabular">{Number(date.slice(8, 10))}</span>
              <span className="flex h-1.5 items-center gap-0.5">
                {glyph && <span className="text-[10px] leading-none">{glyph}</span>}
                {density !== 'none' && (
                  <span
                    className={cn(
                      'rounded-full bg-accent',
                      density === 'light' && 'size-1',
                      density === 'medium' && 'size-1.5',
                      density === 'full' && 'size-2',
                    )}
                  />
                )}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
