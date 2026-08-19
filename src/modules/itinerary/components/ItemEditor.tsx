/**
 * Create or edit one item. Title is the only required field — an idea with
 * nothing but a name is a legitimate, complete thing to save.
 */
'use client'

import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { useCouple } from '@/providers/CoupleProvider'
import { PlacePicker, PlaceSearch, useResolvePlace } from '@/modules/map'
import { describeParseSource, isGoogleMapsLink, parseGoogleMapsLink } from '@/lib/maps/googleMaps'
import { userMessage } from '@/lib/errors'
import type { DateOnly } from '@/lib/dates'
import { itemSchema, type ItemFormValues } from '../schemas'
import { useCreateItem, useDeleteItem, useUpdateItem } from '../hooks'
import type { Category, ItineraryItem } from '../types'

export function ItemEditor({
  tripId,
  item,
  categories,
  defaultDate,
  onClose,
}: {
  tripId: string
  /** Null means "create a new one". */
  item: ItineraryItem | null
  categories: Category[]
  defaultDate?: DateOnly | null
  onClose: () => void
}) {
  const { self, partner } = useCouple()
  const create = useCreateItem(tripId)
  const update = useUpdateItem(tripId)
  const resolvePlace = useResolvePlace()

  const [mapsInput, setMapsInput] = useState('')
  const [placeNote, setPlaceNote] = useState<string | null>(null)
  const [pinNote, setPinNote] = useState<string | null>(null)

  /**
   * Read a pasted Google Maps link into the location fields.
   *
   * The same path the wishlist form uses, deliberately — a place is a place,
   * and somebody who has learned that pasting a link works on one screen should
   * not find it does nothing on the other.
   */
  const onPasteMapsLink = async (url: string) => {
    const trimmed = url.trim()
    if (!trimmed) return

    if (!isGoogleMapsLink(trimmed)) {
      setPlaceNote('That is not a Google Maps link. Search for the place instead.')
      return
    }

    const place = await resolvePlace.mutateAsync(trimmed).catch(() => null)
    if (!place || place.lat === null) {
      setPlaceNote('That map link could not be read — search for the place instead.')
      return
    }

    form.setValue('lat', place.lat)
    form.setValue('lng', place.lng)
    if (place.address) form.setValue('address', place.address)
    if (place.mapsUrl) form.setValue('maps_url', place.mapsUrl)
    if (place.name && !form.getValues('place_name')) form.setValue('place_name', place.name)
    if (place.name && !form.getValues('title')) form.setValue('title', place.name)

    setPlaceNote(place.address ? `Found ${place.name ?? 'it'} — ${place.address}` : 'Pin set.')
    setPinNote(describeParseSource(parseGoogleMapsLink(trimmed)))
  }
  const remove = useDeleteItem(tripId)

  const form = useForm<ItemFormValues>({
    resolver: zodResolver(itemSchema),
    defaultValues: blankValues(defaultDate ?? null, self?.id ?? null),
  })

  useEffect(() => {
    form.reset(item ? toValues(item) : blankValues(defaultDate ?? null, self?.id ?? null))
    // Reset only when the identity of what's being edited changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, defaultDate])

  const scheduled = form.watch('scheduled_date')
  const pending = create.isPending || update.isPending
  const error = create.error ?? update.error

  const onSubmit = form.handleSubmit(async (values) => {
    if (item) {
      await update.mutateAsync({ id: item.id, patch: values })
    } else {
      await create.mutateAsync(values)
    }
    onClose()
  })

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="What is it?" error={form.formState.errors.title?.message} htmlFor="item-title">
        <Input id="item-title" autoFocus placeholder="Dinner at Cervejaria Ramiro" {...form.register('title')} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Day"
          hint="Leave blank to keep it in the pool"
          error={form.formState.errors.scheduled_date?.message}
          htmlFor="item-date"
        >
          <Input id="item-date" type="date" {...form.register('scheduled_date')} />
        </Field>
        <Field label="Category" htmlFor="item-category">
          <Select id="item-category" {...form.register('category_id')}>
            <option value="">None</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {scheduled && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Starts"
            hint="Local time where you are"
            error={form.formState.errors.start_time?.message}
            htmlFor="item-start"
          >
            <Input id="item-start" type="time" {...form.register('start_time')} />
          </Field>
          <Field label="Ends" htmlFor="item-end">
            <Input id="item-end" type="time" {...form.register('end_time')} />
          </Field>
          <Field label="Or minutes" htmlFor="item-duration">
            <Input id="item-duration" type="number" min={1} {...form.register('duration_minutes')} />
          </Field>
        </div>
      )}

      {/* A plan item without a location cannot be drawn on the map or routed
          between, which is most of what the map module is for. The schema has
          carried lat/lng since phase 3; until now nothing in the UI could
          fill them, so an item added by hand was invisible on the map. */}
      <Field label="Place" hint="Optional" htmlFor="item-place">
        <Input id="item-place" {...form.register('place_name')} />
      </Field>

      <Field
        label="Map link"
        hint="Paste a Google Maps link and the address and pin fill themselves"
        htmlFor="item-maps"
      >
        <div className="flex gap-2">
          <Input
            id="item-maps"
            placeholder="https://maps.app.goo.gl/…"
            value={mapsInput}
            onChange={(e) => setMapsInput(e.target.value)}
            onBlur={(e) => void onPasteMapsLink(e.target.value)}
          />
          <Button
            type="button"
            variant="outline"
            disabled={resolvePlace.isPending}
            onClick={() => void onPasteMapsLink(mapsInput)}
          >
            <Link2 aria-hidden="true" />
            {resolvePlace.isPending ? 'Reading…' : 'Read'}
          </Button>
        </div>
      </Field>
      {placeNote && <p className="-mt-2 text-xs text-muted-foreground">{placeNote}</p>}

      <Field label="Or search for it" htmlFor="item-place-search">
        <PlaceSearch
          id="item-place-search"
          placeholder="Search for the place"
          onPick={(place) => {
            form.setValue('lat', place.lat)
            form.setValue('lng', place.lng)
            form.setValue('address', place.displayName)
            if (!form.getValues('place_name')) form.setValue('place_name', place.name)
            if (!form.getValues('title')) form.setValue('title', place.name)
            setPinNote(null)
            setPlaceNote(null)
          }}
        />
      </Field>

      <PlacePicker
        lat={form.watch('lat') ?? null}
        lng={form.watch('lng') ?? null}
        title={form.watch('place_name') || form.watch('title') || ''}
        address={form.watch('address') ?? null}
        note={pinNote}
        onMove={(at) => {
          form.setValue('lat', at.lat)
          form.setValue('lng', at.lng)
          form.setValue('address', null)
          form.setValue('maps_url', null)
          setPinNote('Pin moved by hand.')
        }}
        onClear={() => {
          form.setValue('lat', null)
          form.setValue('lng', null)
          form.setValue('address', null)
          form.setValue('maps_url', null)
          setPinNote(null)
          setPlaceNote(null)
        }}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Rough cost" htmlFor="item-cost">
          <Input id="item-cost" type="number" min={0} step="0.01" {...form.register('cost_estimate')} />
        </Field>
        <Field label="Currency" hint="Three letters" htmlFor="item-currency">
          <Input id="item-currency" maxLength={3} className="uppercase" {...form.register('currency')} />
        </Field>
      </div>

      <Field label="Link" error={form.formState.errors.url?.message} htmlFor="item-url">
        <Input id="item-url" type="url" {...form.register('url')} />
      </Field>

      <Field label="Notes" htmlFor="item-notes">
        <Textarea id="item-notes" rows={3} {...form.register('notes')} />
      </Field>

      <Field label="Whose idea" htmlFor="item-proposer">
        <Select id="item-proposer" {...form.register('proposed_by')}>
          <option value="">Unattributed</option>
          {self && <option value={self.id}>You</option>}
          {partner && <option value={partner.id}>{partner.display_name ?? 'Partner'}</option>}
        </Select>
      </Field>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {userMessage(error)}
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-2 pt-1">
        <div className="flex gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : item ? 'Save' : 'Add'}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>

        {item && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Delete item"
            onClick={async () => {
              await remove.mutateAsync(item.id)
              onClose()
            }}
          >
            <Trash2 className="text-destructive" aria-hidden="true" />
          </Button>
        )}
      </div>
    </form>
  )
}

function blankValues(date: DateOnly | null, selfId: string | null): ItemFormValues {
  return {
    title: '',
    scheduled_date: date,
    start_time: null,
    end_time: null,
    duration_minutes: null,
    place_name: null,
    lat: null,
    lng: null,
    address: null,
    maps_url: null,
    category_id: null,
    notes: null,
    url: null,
    cost_estimate: null,
    currency: null,
    proposed_by: selfId,
  }
}

function toValues(item: ItineraryItem): ItemFormValues {
  return {
    title: item.title,
    scheduled_date: item.scheduled_date,
    start_time: item.start_time?.slice(0, 5) ?? null,
    end_time: item.end_time?.slice(0, 5) ?? null,
    duration_minutes: item.duration_minutes,
    place_name: item.place_name,
    lat: item.lat,
    lng: item.lng,
    address: item.address,
    maps_url: item.maps_url,
    category_id: item.category_id,
    notes: item.notes,
    url: item.url,
    cost_estimate: item.cost_estimate,
    currency: item.currency,
    proposed_by: item.proposed_by,
  }
}
