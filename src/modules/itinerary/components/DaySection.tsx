'use client'

import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Briefcase, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState, RestfulEmpty } from '@/components/common/states'
import { formatInZone, parseDateOnly, type DateOnly } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { ItemCard } from './ItemCard'
import { clashesWithWork, dayWarnings, type EmptyTreatment, type WorkBand } from '../logic'
import type { Category, ItineraryItem } from '../types'
import type { DayType } from '@/modules/trips'

const DAY_TYPE_LABEL: Record<string, string> = {
  travel: 'Travel',
  planned: 'Planned',
  open: 'Open',
  rest: 'Rest',
  work: 'Work',
}

export function DaySection({
  date,
  items,
  categories,
  dayType,
  emptyTreatment,
  isLongStay,
  workBands,
  personName,
  selection,
  onAdd,
  onOpen,
  onSetDayType,
  onToggleSelect,
}: {
  date: DateOnly
  items: ItineraryItem[]
  categories: Category[]
  dayType: DayType
  emptyTreatment: EmptyTreatment
  isLongStay: boolean
  /** Each partner's working day, already in the trip's clock. */
  workBands?: WorkBand[]
  personName?: (id: string) => string
  /** Non-null puts the day in selection mode. */
  selection?: ReadonlySet<string> | null
  onAdd: (date: DateOnly) => void
  onOpen: (item: ItineraryItem) => void
  onSetDayType: (date: DateOnly, type: DayType) => void
  onToggleSelect?: (id: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${date}` })
  const warnings = dayWarnings(items, { isLongStay })
  const categoryById = new Map(categories.map((c) => [c.id, c]))
  const d = parseDateOnly(date)
  const bands = workBands ?? []

  return (
    <section
      ref={setNodeRef}
      className={cn(
        'rounded-lg border border-transparent p-2 transition-colors',
        isOver && 'border-dashed border-accent bg-accent/5',
      )}
    >
      <header className="mb-2 flex items-center justify-between gap-2 px-1">
        <div className="flex items-baseline gap-2">
          <h3 className="font-medium">{formatInZone(d, 'UTC', 'EEEE d MMM')}</h3>
          {items.length > 0 && (
            <span className="text-xs text-muted-foreground">{items.length}</span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <select
            aria-label={`Day type for ${date}`}
            value={dayType}
            onChange={(e) => onSetDayType(date, e.target.value as DayType)}
            className="rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-muted-foreground hover:border-border"
          >
            {Object.entries(DAY_TYPE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </header>

      {/* Whose day is spoken for, in the trip's own clock rather than theirs
          (see `workBand`). Stated once at the top of the day instead of on
          each item, because it is a fact about the day and repeating it on
          six cards would bury the items themselves. */}
      {bands.length > 0 && (
        <ul className="mb-2 space-y-0.5 px-1">
          {bands.map((band) => (
            <li key={band.personId} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Briefcase className="size-3 shrink-0" aria-hidden="true" />
              <span>
                {personName?.(band.personId) ?? 'Working'} {band.from}–{band.to}
                {band.clipped && ' (runs past midnight there)'}
              </span>
            </li>
          ))}
        </ul>
      )}

      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-2">
          {items.map((item) => {
            const clashing = bands.filter((band) => clashesWithWork(item.start_time, band))
            return (
              <div key={item.id} className="space-y-0.5">
                <div className="flex items-start gap-2">
                  {selection && (
                    <input
                      type="checkbox"
                      className="mt-3 size-4 shrink-0 accent-[hsl(var(--accent))]"
                      checked={selection.has(item.id)}
                      aria-label={`Select ${item.title}`}
                      onChange={() => onToggleSelect?.(item.id)}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <ItemCard
                      item={item}
                      category={item.category_id ? categoryById.get(item.category_id) : undefined}
                      warnings={warnings}
                      onOpen={onOpen}
                    />
                  </div>
                </div>
                {clashing.length > 0 && (
                  <p className="pl-1 text-xs text-[hsl(var(--warn))]">
                    {clashing
                      .map((band) => personName?.(band.personId) ?? 'Someone')
                      .join(' and ')}{' '}
                    {clashing.length === 1 ? 'is' : 'are'} working then.
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </SortableContext>

      {items.length === 0 &&
        // The whole point of the module. On a long stay a blank day is the
        // goal, so it gets a word and nothing else — no prompt, no button.
        (emptyTreatment === 'restful' ? (
          <RestfulEmpty label="Open" />
        ) : (
          <EmptyState
            subtle
            title="Nothing planned"
            action={
              <Button size="sm" variant="ghost" onClick={() => onAdd(date)}>
                <Plus aria-hidden="true" />
                Add
              </Button>
            }
          />
        ))}
    </section>
  )
}
