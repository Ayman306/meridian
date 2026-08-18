/**
 * The wishlist: places either of them saved, whether or not a trip exists yet.
 *
 * `add_wishlist_item` is a direct write, unlike anything itinerary-shaped. The
 * distinction is who is doing the deciding. A generated day-plan is the
 * assistant's proposal and belongs in the tray; "add the ramen place my sister
 * mentioned to our list" is the person dictating, and routing their own
 * sentence through a review queue would be pointless ceremony.
 *
 * The wishlist is also the safe place for an assistant to put an idea it is
 * unsure about — it is a list of maybes by construction, so nothing there
 * claims to be part of a plan.
 */
import { z } from 'zod'
import { defineTool, requireCouple } from './types'
import type { AnyTool } from './types'

const listWishlist = defineTool({
  name: 'list_wishlist',
  module: 'wishlist',
  title: 'List saved places',
  description:
    'Places the couple has saved, newest first. Useful before suggesting an itinerary — things already on this list are things they have shown interest in.',
  readOnly: true,
  inputSchema: z.object({
    city: z.string().nullable().default(null).describe('Filter to one city, matched loosely.'),
    limit: z.number().int().min(1).max(100).default(40).describe('How many to return.'),
  }),
  async handler(ctx, input) {
    requireCouple(ctx)

    let query = ctx.supabase
      .from('wishlist_items')
      .select('id, title, place_name, city, country_code, notes, url, intensity')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(input.limit)

    if (input.city) query = query.ilike('city', `%${input.city}%`)

    const { data, error } = await query
    if (error) throw new Error(error.message)
    if (!data?.length) {
      return input.city ? `Nothing saved for ${input.city}.` : 'The wishlist is empty.'
    }

    return data
      .map((row) => {
        const parts = [`${row.title} (${row.id})`]
        if (row.place_name && row.place_name !== row.title) parts.push(row.place_name)
        if (row.city) parts.push([row.city, row.country_code].filter(Boolean).join(', '))
        if (row.intensity) parts.push(`keenness ${row.intensity}`)
        if (row.notes) parts.push(`— ${row.notes}`)
        return `- ${parts.join(' · ')}`
      })
      .join('\n')
  },
})

const addWishlistItem = defineTool({
  name: 'add_wishlist_item',
  module: 'wishlist',
  title: 'Save a place',
  description:
    'Add a place to the shared wishlist. This writes immediately — use it when the person is telling you about somewhere they want to go, not when you are generating ideas. For generated day-plans use suggest_itinerary instead, which goes to the review tray.',
  readOnly: false,
  inputSchema: z.object({
    title: z.string().min(1).describe('What it is.'),
    place_name: z.string().nullable().default(null).describe('The venue, if it is a specific one.'),
    city: z.string().nullable().default(null).describe('The city it is in.'),
    country_code: z
      .string()
      .length(2)
      .nullable()
      .default(null)
      .describe('ISO 3166-1 alpha-2, uppercase. Omit rather than guessing.'),
    notes: z.string().nullable().default(null).describe('Why it is worth going.'),
    url: z.string().url().nullable().default(null).describe('A real link only. Never invent one.'),
  }),
  async handler(ctx, input) {
    const coupleId = requireCouple(ctx)

    const { data, error } = await ctx.supabase
      .from('wishlist_items')
      .insert({
        couple_id: coupleId,
        // Whose save it is. The assistant is acting for the person holding the
        // token, and the app shows saves by author, so this has to be them.
        user_id: ctx.userId,
        title: input.title,
        place_name: input.place_name,
        city: input.city,
        country_code: input.country_code?.toUpperCase() ?? null,
        notes: input.notes,
        url: input.url,
      })
      .select('id')
      .single()

    if (error) throw new Error(error.message)
    return `Saved "${input.title}" to the wishlist (${data.id}).`
  },
})



const voteOnWishlistItem = defineTool({
  name: 'vote_on_wishlist_item',
  module: 'wishlist',
  title: 'Record your verdict on a saved place',
  description:
    'Record how keen YOU are on a saved place — yes, no or maybe. This is your own vote and can never be cast for your partner; the point of the two verdicts is that they are two people’s.',
  readOnly: false,
  inputSchema: z.object({
    wishlist_id: z.string().uuid().describe('From list_wishlist.'),
    verdict: z.enum(['yes', 'no', 'maybe']).describe('Only what the person actually said.'),
  }),
  async handler(ctx, input) {
    requireCouple(ctx)

    const { error } = await ctx.supabase.from('wishlist_verdicts').upsert(
      {
        wishlist_id: input.wishlist_id,
        // Always the caller. A partner id here would let one person answer for
        // both, which empties the feature of its meaning.
        user_id: ctx.userId,
        verdict: input.verdict,
      },
      { onConflict: 'wishlist_id,user_id' },
    )
    if (error) throw new Error(error.message)

    return `Recorded your verdict: ${input.verdict}.`
  },
})

const removeWishlistItem = defineTool({
  name: 'remove_wishlist_item',
  module: 'wishlist',
  title: 'Remove a saved place',
  description:
    'Take a place off the wishlist. Soft-deleted, so it is recoverable in the app for thirty days.',
  readOnly: false,
  inputSchema: z.object({
    wishlist_id: z.string().uuid().describe('From list_wishlist.'),
  }),
  async handler(ctx, input) {
    requireCouple(ctx)

    const { data, error } = await ctx.supabase
      .from('wishlist_items')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', input.wishlist_id)
      .is('deleted_at', null)
      .select('title')
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return 'No saved place with that id, or it was already removed.'

    return `Removed "${data.title}". Recoverable in the app for thirty days.`
  },
})

export const wishlistTools: AnyTool[] = [
  listWishlist,
  addWishlistItem,
  voteOnWishlistItem,
  removeWishlistItem,
]
