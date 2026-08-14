import { z } from 'zod'

const emptyToNull = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === '' || v === undefined ? null : v), schema.nullable())

/**
 * A save needs a title and nothing else.
 *
 * City is deliberately optional: the whole point of the wishlist is that it
 * works before a destination exists (spec 7.2). Intensity too — an unrated
 * list is a perfectly good list.
 */
export const wishlistSchema = z.object({
  title: z.string().trim().min(1, 'What is it?').max(200),
  city: emptyToNull(z.string().trim().max(120)),
  country_code: emptyToNull(z.string().trim().length(2)),
  place_name: emptyToNull(z.string().trim().max(200)),
  address: emptyToNull(z.string().trim().max(400)),
  lat: emptyToNull(z.coerce.number().min(-90).max(90)),
  lng: emptyToNull(z.coerce.number().min(-180).max(180)),
  maps_url: emptyToNull(z.string().url('That is not a link')),
  category_id: emptyToNull(z.string().uuid()),
  intensity: emptyToNull(z.coerce.number().int().min(1).max(5)),
  url: emptyToNull(z.string().url('That is not a link')),
  notes: emptyToNull(z.string().trim().max(4000)),
  image_url: emptyToNull(z.string().url()),
})

export type WishlistFormValues = z.output<typeof wishlistSchema>
export type WishlistFormInput = z.input<typeof wishlistSchema>

/** What `/api/extract` accepts and returns. Shared by the route and its caller. */
export const extractRequestSchema = z.object({
  url: z.string().url(),
})

export const extractResponseSchema = z.object({
  title: z.string().nullable(),
  image: z.string().nullable(),
  description: z.string().nullable(),
  siteName: z.string().nullable(),
})

export type ExtractResult = z.infer<typeof extractResponseSchema>
