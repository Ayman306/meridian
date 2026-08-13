import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { AlertTriangle, GripVertical, MapPin } from 'lucide-react'
import { PersonBadge } from '@/components/PersonBadge'
import { Badge } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { useCouple } from '@/providers/CoupleProvider'
import { toPersonRef } from '@/modules/auth'
import { formatItemTime } from '../logic'
import type { Category, ItemWarning, ItineraryItem } from '../types'

export function ItemCard({
  item,
  category,
  warnings = [],
  onOpen,
  draggable = true,
}: {
  item: ItineraryItem
  category?: Category | undefined
  warnings?: ItemWarning[]
  onOpen?: (item: ItineraryItem) => void
  draggable?: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: !draggable,
  })

  const { self, partner } = useCouple()
  const proposer =
    item.proposed_by === self?.id
      ? toPersonRef(self, self?.id ?? null)
      : item.proposed_by === partner?.id
        ? toPersonRef(partner, self?.id ?? null)
        : null

  const time = formatItemTime(item)
  const mine = warnings.filter((w) => w.itemId === item.id)

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        'group flex items-start gap-2 rounded-md border border-border bg-card p-3',
        isDragging && 'opacity-40',
      )}
    >
      {draggable && (
        <button
          {...attributes}
          {...listeners}
          className="mt-0.5 cursor-grab touch-none rounded text-muted-foreground/50 hover:text-muted-foreground"
          aria-label={`Reorder ${item.title}`}
        >
          <GripVertical className="size-4" aria-hidden="true" />
        </button>
      )}

      <button
        className="min-w-0 flex-1 space-y-1 text-left"
        onClick={() => onOpen?.(item)}
        aria-label={`Edit ${item.title}`}
      >
        <div className="flex items-baseline gap-2">
          {time && <span className="tabular shrink-0 text-sm font-medium">{time}</span>}
          <span className="truncate font-medium">{item.title}</span>
        </div>

        {(item.place_name || category) && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {category && <Badge tone="neutral">{category.name}</Badge>}
            {item.place_name && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3" aria-hidden="true" />
                {item.place_name}
              </span>
            )}
          </div>
        )}

        {mine.map((w) => (
          <p
            key={`${w.kind}-${w.itemId}`}
            className="inline-flex items-center gap-1 text-xs text-[hsl(var(--warn))]"
          >
            <AlertTriangle className="size-3" aria-hidden="true" />
            {w.message}
          </p>
        ))}
      </button>

      <PersonBadge person={proposer} size="xs" />
    </div>
  )
}
