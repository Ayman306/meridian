'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { userMessage } from '@/lib/errors'
import { PlacePicker, PlaceSearch, useResolvePlace } from '@/modules/map'
import { describeParseSource, isGoogleMapsLink, parseGoogleMapsLink } from '@/lib/maps/googleMaps'
import type { Category } from '@/modules/itinerary'
import { useAddWishlistItem, useExtractFromUrl, useUpdateWishlistItem } from '../hooks'
import { wishlistSchema, type WishlistFormValues } from '../schemas'
import type { WishlistItem } from '../types'

const EMPTY: WishlistFormValues = {
  title: '',
  city: null,
  country_code: null,
  place_name: null,
  address: null,
  lat: null,
  lng: null,
  maps_url: null,
  category_id: null,
  intensity: null,
  url: null,
  notes: null,
  image_url: null,
}

export function WishlistForm({
  item,
  categories,
  onClose,
}: {
  item?: WishlistItem | null
  categories: Category[]
  onClose: () => void
}) {
  const add = useAddWishlistItem()
  const update = useUpdateWishlistItem()
  const extract = useExtractFromUrl()
  const resolvePlace = useResolvePlace()
  const [extracted, setExtracted] = useState<string | null>(null)
  const [pinNote, setPinNote] = useState<string | null>(null)

  const form = useForm<WishlistFormValues>({
    resolver: zodResolver(wishlistSchema),
    defaultValues: item
      ? {
          ...EMPTY,
          ...item,
          lat: item.lat === null ? null : Number(item.lat),
          lng: item.lng === null ? null : Number(item.lng),
        }
      : EMPTY,
  })

  const onSubmit = form.handleSubmit(async (values) => {
    if (item) await update.mutateAsync({ id: item.id, patch: values })
    else await add.mutateAsync(values)
    onClose()
  })

  /**
   * Paste a link, get a title. Spec 7.2 — the common case is copying a
   * restaurant out of Instagram, and typing its name again is the friction
   * that stops people saving things.
   */
  const onPasteLink = async (url: string) => {
    const trimmed = url.trim()
    if (!trimmed) return

    // One field, two behaviours, decided by what was actually pasted. A maps
    // link and a restaurant's Instagram post are both "a link somebody copied",
    // and asking which box it goes in is friction for no benefit.
    if (isGoogleMapsLink(trimmed)) return onPasteMapsLink(trimmed)

    const result = await extract.mutateAsync(trimmed)
    if (!result) {
      setExtracted('That link did not give up a title — type one in.')
      return
    }
    if (result.title && !form.getValues('title')) form.setValue('title', result.title)
    if (result.image) form.setValue('image_url', result.image)
    setExtracted(result.title ? `Read “${result.title}” from ${result.siteName ?? 'the page'}.` : null)
  }

  /**
   * A Google Maps link, which carries the one thing an OpenGraph read cannot:
   * where the place actually is.
   */
  const onPasteMapsLink = async (url: string) => {
    const place = await resolvePlace.mutateAsync(url).catch(() => null)

    if (!place || (place.lat === null && !place.name)) {
      setExtracted('That map link could not be read — search for the place below instead.')
      return
    }

    if (place.name && !form.getValues('title')) form.setValue('title', place.name)
    if (place.name) form.setValue('place_name', place.name)
    if (place.lat !== null) form.setValue('lat', place.lat)
    if (place.lng !== null) form.setValue('lng', place.lng)
    if (place.address) form.setValue('address', place.address)
    if (place.city) form.setValue('city', place.city)
    if (place.countryCode) form.setValue('country_code', place.countryCode)
    // The canonical link, rebuilt from the coordinates we settled on rather
    // than the one pasted — a corrected pin should not keep opening the old spot.
    if (place.mapsUrl) form.setValue('maps_url', place.mapsUrl)

    setExtracted(
      place.address
        ? `Found ${place.name ?? 'the place'} — ${place.address}`
        : `Found ${place.name ?? 'the place'}.`,
    )
    // A camera-derived pin is approximate, and the person needs telling.
    setPinNote(describeParseSource(parseGoogleMapsLink(url)))
  }

  const pending = add.isPending || update.isPending
  const error = add.error ?? update.error

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Link" hint="Paste one and we'll try to read the title" htmlFor="wish-url">
        <div className="flex gap-2">
          <Input
            id="wish-url"
            placeholder="https://…"
            {...form.register('url')}
            onBlur={(e) => void onPasteLink(e.target.value)}
          />
          <Button
            variant="outline"
            disabled={extract.isPending}
            onClick={() => void onPasteLink(form.getValues('url') ?? '')}
          >
            <Link2 aria-hidden="true" />
            {extract.isPending ? 'Reading…' : 'Read'}
          </Button>
        </div>
      </Field>
      {extracted && <p className="-mt-2 text-xs text-muted-foreground">{extracted}</p>}

      <Field label="What is it?" error={form.formState.errors.title?.message} htmlFor="wish-title">
        <Input id="wish-title" autoFocus placeholder="That tiny pastelaria" {...form.register('title')} />
      </Field>

      <Field
        label="Where"
        hint="Optional — save it now, work out the city later"
        htmlFor="wish-place"
      >
        <PlaceSearch
          id="wish-place"
          placeholder="Search for the place"
          onPick={(place) => {
            form.setValue('lat', place.lat)
            form.setValue('lng', place.lng)
            form.setValue('place_name', place.name)
            form.setValue('address', place.displayName)
            if (place.city) form.setValue('city', place.city)
            if (place.countryCode) form.setValue('country_code', place.countryCode)
            if (!form.getValues('title')) form.setValue('title', place.name)
            setPinNote(null)
          }}
        />
      </Field>

      {/* Seeing the pin is the check that matters. A link copied after panning
          carries the camera position rather than the place, so the name and
          address can look right while the coordinates are a street off — which
          a map shows instantly and two decimal numbers never do. */}
      <PlacePicker
        lat={form.watch('lat') ?? null}
        lng={form.watch('lng') ?? null}
        title={form.watch('title') ?? ''}
        address={form.watch('address') ?? null}
        note={pinNote}
        onMove={(at) => {
          form.setValue('lat', at.lat)
          form.setValue('lng', at.lng)
          // The address described the old coordinates. Keeping it would make it
          // a claim about somewhere else.
          form.setValue('address', null)
          form.setValue('maps_url', null)
          setPinNote('Pin moved by hand. The address will be looked up again when you save.')
        }}
        onClear={() => {
          form.setValue('lat', null)
          form.setValue('lng', null)
          form.setValue('address', null)
          form.setValue('maps_url', null)
          setPinNote(null)
        }}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="City" error={form.formState.errors.city?.message} htmlFor="wish-city">
          <Input id="wish-city" placeholder="Lisbon" {...form.register('city')} />
        </Field>
        <Field label="Category" htmlFor="wish-category">
          <Select id="wish-category" {...form.register('category_id')}>
            <option value="">Unfiled</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field
        label="How much do you want this?"
        hint="Optional. Fives get picked first when a draft is generated."
        htmlFor="wish-intensity"
      >
        <Select id="wish-intensity" {...form.register('intensity')}>
          <option value="">Not saying</option>
          <option value="1">1 — mildly curious</option>
          <option value="2">2</option>
          <option value="3">3 — would like to</option>
          <option value="4">4</option>
          <option value="5">5 — this is why we&rsquo;re going</option>
        </Select>
      </Field>

      <Field label="Notes" htmlFor="wish-notes">
        <Textarea id="wish-notes" rows={2} {...form.register('notes')} />
      </Field>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {userMessage(error)}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : item ? 'Save changes' : 'Save it'}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
