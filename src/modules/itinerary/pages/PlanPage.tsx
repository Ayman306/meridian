/**
 * The main planning surface.
 *
 * Short trips get a day list; stays over five nights get a month grid, where
 * blank days are the desired state and are rendered as such.
 */
'use client'

import { useCallback, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { CheckSquare, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState, ErrorState, SkeletonList } from '@/components/common/states'
import { formatInZone, parseDateOnly, type DateOnly } from '@/lib/dates'
import { pluralise } from '@/lib/utils'
import { isLongStay, nights, useSetDayType, useTrip, type DayType } from '@/modules/trips'
import { useCouple } from '@/providers/CoupleProvider'
import {
  useBulkMove,
  useCategories,
  useItems,
  useItineraryRealtime,
  useMoveItem,
} from '../hooks'
import { buildPlan, emptyDayTreatment, planDays, sortDayItems, workBand } from '../logic'
import { IdeaPool } from '../components/IdeaPool'
import { DaySection } from '../components/DaySection'
import { MonthGrid } from '../components/MonthGrid'
import { ItemEditor } from '../components/ItemEditor'
import { SuggestionTray } from '../components/SuggestionTray'
import { ItemCard } from '../components/ItemCard'
import type { ItineraryItem } from '../types'

export function PlanPage() {
  // The trip is already in the cache — the layout above fetched it — so this
  // is a cache read, not a second round trip.
  const params = useParams<{ id: string }>()
  const tripId = params.id
  const { data: trip } = useTrip(tripId)
  const { self, partner, tzSelf } = useCouple()

  const items = useItems(tripId)
  const categories = useCategories()
  const move = useMoveItem(tripId)
  const setDayType = useSetDayType(tripId)
  const bulkMove = useBulkMove(tripId)
  useItineraryRealtime(tripId)

  const [editing, setEditing] = useState<{ item: ItineraryItem | null; date: DateOnly | null } | null>(
    null,
  )
  const [dragging, setDragging] = useState<ItineraryItem | null>(null)
  const [selectedDay, setSelectedDay] = useState<DateOnly | null>(null)
  // Null means selection mode is off entirely. An empty set means it is on and
  // nothing is picked yet — a distinction the day sections need, since one
  // shows checkboxes and the other does not.
  const [picked, setPicked] = useState<Set<string> | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const start = trip?.start_date ?? null
  const end = trip?.end_date ?? null

  const plan = useMemo(() => buildPlan(items.data ?? [], start, end), [items.data, start, end])
  const days = useMemo(() => planDays(start, end), [start, end])
  const dayTypes = useMemo(
    () => Object.fromEntries((trip?.days ?? []).map((d) => [d.date, d.day_type])),
    [trip?.days],
  )

  // Both working days, moved into the trip's clock. Read from the profiles
  // rather than user_settings, because the partner's hours are the ones worth
  // knowing and user_settings is own-only (0021).
  const people = useMemo(
    () => [self, partner].filter((p): p is NonNullable<typeof p> => Boolean(p)),
    [self, partner],
  )
  const bandsFor = useCallback(
    (date: DateOnly) =>
      people
        .map((person) => workBand(person, date, trip?.timezone ?? tzSelf))
        .filter((band): band is NonNullable<typeof band> => band !== null),
    [people, trip?.timezone, tzSelf],
  )
  const personName = useCallback(
    (id: string) => people.find((p) => p.id === id)?.display_name ?? 'Someone',
    [people],
  )

  const tripNights = trip ? nights(trip) : null
  const longStay = trip ? isLongStay(trip) : false
  const treatment = emptyDayTreatment(tripNights)

  if (!trip || items.isLoading || categories.isLoading) return <SkeletonList rows={4} />
  if (items.error) return <ErrorState error={items.error} onRetry={() => void items.refetch()} />

  const cats = categories.data ?? []

  const toggle = (id: string) =>
    setPicked((current) => {
      const next = new Set(current ?? [])
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const movePicked = (date: DateOnly | null) => {
    if (!picked || picked.size === 0) return
    bulkMove.mutate({ ids: [...picked], date })
    setPicked(new Set())
  }

  const onDragEnd = (event: DragEndEvent) => {
    setDragging(null)
    const { active, over } = event
    if (!over) return

    const item = (items.data ?? []).find((i) => i.id === active.id)
    if (!item) return

    const target = resolveDropTarget(String(over.id), plan, items.data ?? [])
    if (!target) return

    const siblings = (target.date ? (plan.byDate[target.date] ?? []) : plan.pool).filter(
      (i) => i.id !== item.id,
    )
    const index =
      target.overItemId === null
        ? siblings.length
        : Math.max(0, siblings.findIndex((i) => i.id === target.overItemId))

    const before = index > 0 ? (siblings[index - 1]?.sort_key ?? null) : null
    const after = index < siblings.length ? (siblings[index]?.sort_key ?? null) : null

    // Nothing actually changed — don't burn a write on it.
    if (item.scheduled_date === target.date && before === null && after === null) return

    move.mutate({ id: item.id, date: target.date, beforeKey: before, afterKey: after })
  }

  const onDragStart = (event: DragStartEvent) => {
    setDragging((items.data ?? []).find((i) => i.id === event.active.id) ?? null)
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className="space-y-6">
        {/* Selection is a mode rather than always-on. Checkboxes beside every
            item on a plan somebody is reading is clutter; the same checkboxes
            after they said "select" is the feature. */}
        {days.length > 0 && (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={picked ? 'secondary' : 'ghost'}
              aria-pressed={picked !== null}
              onClick={() => setPicked(picked ? null : new Set())}
            >
              {picked ? <X aria-hidden="true" /> : <CheckSquare aria-hidden="true" />}
              {picked ? 'Done selecting' : 'Select several'}
            </Button>
          </div>
        )}

        <SuggestionTray tripId={tripId} />

        <IdeaPool
          items={plan.pool}
          categories={cats}
          onAdd={() => setEditing({ item: null, date: null })}
          onOpen={(item) => setEditing({ item, date: null })}
        />

        {plan.orphaned.length > 0 && (
          <OrphanedItems items={plan.orphaned} onOpen={(item) => setEditing({ item, date: null })} />
        )}

        {days.length === 0 ? (
          // No dates means no day grid at all; the scheduling controls would
          // have nothing to attach to. The pool above is the whole plan.
          <EmptyState
            title="No dates yet"
            description="Set the trip's dates and the days appear here. Until then, ideas live in the pool."
          />
        ) : longStay ? (
          <div className="space-y-4">
            <MonthGrid
              days={days}
              itemsByDate={plan.byDate}
              dayTypes={dayTypes}
              selected={selectedDay}
              onSelect={setSelectedDay}
            />
            {selectedDay && (
              <DaySection
                date={selectedDay}
                items={plan.byDate[selectedDay] ?? []}
                categories={cats}
                dayType={(dayTypes[selectedDay] ?? 'open') as DayType}
                emptyTreatment={treatment}
                isLongStay={longStay}
                workBands={bandsFor(selectedDay)}
                personName={personName}
                selection={picked}
                onToggleSelect={toggle}
                onAdd={(date) => setEditing({ item: null, date })}
                onOpen={(item) => setEditing({ item, date: null })}
                onSetDayType={(date, dayType) => setDayType.mutate({ date, dayType })}
              />
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {days.map((date) => (
              <DaySection
                key={date}
                date={date}
                items={plan.byDate[date] ?? []}
                categories={cats}
                dayType={(dayTypes[date] ?? 'open') as DayType}
                emptyTreatment={treatment}
                isLongStay={longStay}
                workBands={bandsFor(date)}
                personName={personName}
                selection={picked}
                onToggleSelect={toggle}
                onAdd={(d) => setEditing({ item: null, date: d })}
                onOpen={(item) => setEditing({ item, date: null })}
                onSetDayType={(d, dayType) => setDayType.mutate({ date: d, dayType })}
              />
            ))}
          </div>
        )}

        {picked && picked.size > 0 && (
          <div className="sticky bottom-16 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background/95 p-3 shadow-lg backdrop-blur md:bottom-4">
            <span className="text-sm">{pluralise(picked.size, 'item')} selected</span>
            <label className="flex items-center gap-2 text-sm">
              <span className="sr-only">Move to day</span>
              <select
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                value=""
                onChange={(e) => e.target.value && movePicked(e.target.value)}
              >
                <option value="">Move to…</option>
                {days.map((date) => (
                  <option key={date} value={date}>
                    {formatInZone(parseDateOnly(date), 'UTC', 'EEE d MMM')}
                  </option>
                ))}
              </select>
            </label>
            <Button size="sm" variant="outline" onClick={() => movePicked(null)}>
              Back to the pool
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>
              Clear
            </Button>
          </div>
        )}

        {tripNights !== null && (
          <p className="text-xs text-muted-foreground">
            {pluralise(tripNights, 'night')}
            {longStay && ' · long stay, so open days stay open'}
          </p>
        )}

        {editing && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {editing.item
                  ? 'Edit'
                  : editing.date
                    ? `Add to ${formatInZone(parseDateOnly(editing.date), 'UTC', 'EEE d MMM')}`
                    : 'Add an idea'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ItemEditor
                tripId={tripId}
                item={editing.item}
                categories={cats}
                defaultDate={editing.date}
                onClose={() => setEditing(null)}
              />
            </CardContent>
          </Card>
        )}

        {!editing && (
          <Button variant="outline" onClick={() => setEditing({ item: null, date: null })}>
            <Plus aria-hidden="true" />
            Add an idea
          </Button>
        )}
      </div>

      <DragOverlay>
        {dragging ? <ItemCard item={dragging} draggable={false} /> : null}
      </DragOverlay>
    </DndContext>
  )
}

/**
 * A drop lands either on a container (`pool`, `day:2026-06-04`) or on another
 * item, depending on where the pointer was. Resolve both to the same shape.
 */
function resolveDropTarget(
  overId: string,
  plan: ReturnType<typeof buildPlan>,
  items: readonly ItineraryItem[],
): { date: DateOnly | null; overItemId: string | null } | null {
  if (overId === 'pool') return { date: null, overItemId: null }
  if (overId.startsWith('day:')) return { date: overId.slice(4), overItemId: null }

  const over = items.find((i) => i.id === overId)
  if (!over) return null
  // Dropping onto an item means "take its place" in whichever list it is in.
  const inPool = plan.pool.some((i) => i.id === over.id)
  return { date: inPool ? null : over.scheduled_date, overItemId: over.id }
}

/** Items stranded outside the trip's range after its dates changed (spec 5.6). */
function OrphanedItems({
  items,
  onOpen,
}: {
  items: ItineraryItem[]
  onOpen: (item: ItineraryItem) => void
}) {
  return (
    <Card className="border-[hsl(var(--warn))]/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Outside the trip dates</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {sortDayItems(items).map((item) => (
          <ItemCard key={item.id} item={item} draggable={false} onOpen={onOpen} />
        ))}
        <p className="text-xs text-muted-foreground">
          These are scheduled on days the trip no longer covers. Open one to move it.
        </p>
      </CardContent>
    </Card>
  )
}
