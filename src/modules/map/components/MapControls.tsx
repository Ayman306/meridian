'use client'

import { Crosshair } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/input'
import { formatInZone, parseDateOnly, type DateOnly } from '@/lib/dates'
import { cn } from '@/lib/utils'
import type { PersonRef } from '@/types/domain'
import type { MapFilters, PinLayer } from '../types'

const LAYER_LABELS: Record<PinLayer, string> = {
  itinerary: 'Scheduled',
  pool: 'Ideas',
  wishlist: 'Wishlist',
  stay: 'Stays',
  photo: 'Photos',
}

export function MapControls({
  filters,
  onChange,
  days,
  people,
  categories,
  states,
  availableLayers,
  onRecenter,
}: {
  filters: MapFilters
  onChange: (next: MapFilters) => void
  days: DateOnly[]
  people: PersonRef[]
  categories: { id: string; name: string }[]
  states: string[]
  availableLayers: PinLayer[]
  onRecenter: () => void
}) {
  const set = <K extends keyof MapFilters>(key: K, value: MapFilters[K]) =>
    onChange({ ...filters, [key]: value })

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {availableLayers.map((layer) => {
          const on = filters.layers[layer]
          return (
            <button
              key={layer}
              type="button"
              aria-pressed={on}
              onClick={() => set('layers', { ...filters.layers, [layer]: !on })}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                on
                  ? 'border-transparent bg-secondary text-secondary-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {LAYER_LABELS[layer]}
            </button>
          )
        })}

        <Button variant="ghost" size="sm" className="ml-auto" onClick={onRecenter}>
          <Crosshair aria-hidden="true" />
          Recentre
        </Button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {days.length > 0 && (
          <label className="text-xs text-muted-foreground">
            Day
            <Select
              className="mt-1 h-9"
              value={filters.day ?? ''}
              onChange={(e) => set('day', e.target.value || null)}
            >
              <option value="">Every day</option>
              {days.map((date) => (
                <option key={date} value={date}>
                  {formatInZone(parseDateOnly(date), 'UTC', 'EEE d MMM')}
                </option>
              ))}
            </Select>
          </label>
        )}

        {people.length > 1 && (
          <label className="text-xs text-muted-foreground">
            Whose pick
            <Select
              className="mt-1 h-9"
              value={filters.personId ?? ''}
              onChange={(e) => set('personId', e.target.value || null)}
            >
              <option value="">Both of you</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.isSelf ? 'You' : person.displayName}
                </option>
              ))}
            </Select>
          </label>
        )}

        {categories.length > 0 && (
          <label className="text-xs text-muted-foreground">
            Category
            <Select
              className="mt-1 h-9"
              value={filters.categoryId ?? ''}
              onChange={(e) => set('categoryId', e.target.value || null)}
            >
              <option value="">Everything</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          </label>
        )}

        {states.length > 1 && (
          <label className="text-xs text-muted-foreground">
            State
            <Select
              className="mt-1 h-9"
              value={filters.state ?? ''}
              onChange={(e) => set('state', e.target.value || null)}
            >
              <option value="">Any state</option>
              {states.map((state) => (
                <option key={state} value={state}>
                  {state}
                </option>
              ))}
            </Select>
          </label>
        )}
      </div>
    </div>
  )
}
