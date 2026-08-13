'use client'

import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/common/states'
import { ItemCard } from './ItemCard'
import type { Category, ItineraryItem } from '../types'
import { cn } from '@/lib/utils'

/**
 * Everything not pinned to a day. Always visible at the top of the plan —
 * ideas that never get scheduled are still worth keeping, and a trip with no
 * dates at all consists of nothing else.
 */
export function IdeaPool({
  items,
  categories,
  onAdd,
  onOpen,
}: {
  items: ItineraryItem[]
  categories: Category[]
  onAdd: () => void
  onOpen: (item: ItineraryItem) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: 'pool' })
  const categoryById = new Map(categories.map((c) => [c.id, c]))

  return (
    <Card className={cn(isOver && 'border-dashed border-accent bg-accent/5')}>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base">
          Ideas
          {items.length > 0 && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">{items.length}</span>
          )}
        </CardTitle>
        <Button size="sm" variant="ghost" onClick={onAdd}>
          <Plus aria-hidden="true" />
          Add
        </Button>
      </CardHeader>

      <CardContent ref={setNodeRef} className="pb-4">
        <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {items.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                category={item.category_id ? categoryById.get(item.category_id) : undefined}
                onOpen={onOpen}
              />
            ))}
          </div>
        </SortableContext>

        {items.length === 0 && (
          <EmptyState
            subtle
            title="Nothing saved yet"
            action={
              <Button size="sm" onClick={onAdd}>
                Add your first idea
              </Button>
            }
          />
        )}
      </CardContent>
    </Card>
  )
}
