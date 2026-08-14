'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { userMessage } from '@/lib/errors'
import { PlaceSearch } from '@/modules/map'
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
  const [extracted, setExtracted] = useState<string | null>(null)

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
    if (!url.trim()) return
    const result = await extract.mutateAsync(url.trim())
    if (!result) {
      setExtracted('That link did not give up a title — type one in.')
      return
    }
    if (result.title && !form.getValues('title')) form.setValue('title', result.title)
    if (result.image) form.setValue('image_url', result.image)
    setExtracted(result.title ? `Read “${result.title}” from ${result.siteName ?? 'the page'}.` : null)
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
          }}
        />
      </Field>

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
