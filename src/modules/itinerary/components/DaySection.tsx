import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState, RestfulEmpty } from '@/components/common/states'
import { formatInZone, parseDateOnly, type DateOnly } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { ItemCard } from './ItemCard'
import { dayWarnings, type EmptyTreatment } from '../logic'
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
  onAdd,
  onOpen,
  onSetDayType,
}: {
  date: DateOnly
  items: ItineraryItem[]
  categories: Category[]
  dayType: DayType
  emptyTreatment: EmptyTreatment
  isLongStay: boolean
  onAdd: (date: DateOnly) => void
  onOpen: (item: ItineraryItem) => void
  onSetDayType: (date: DateOnly, type: DayType) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${date}` })
  const warnings = dayWarnings(items, { isLongStay })
  const categoryById = new Map(categories.map((c) => [c.id, c]))
  const d = parseDateOnly(date)

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

      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-2">
          {items.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              category={item.category_id ? categoryById.get(item.category_id) : undefined}
              warnings={warnings}
              onOpen={onOpen}
            />
          ))}
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
