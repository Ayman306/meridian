/**
 * Reading the plan, and changing it.
 *
 * Two kinds of write live here, and the line between them is the whole point
 * (spec Part 15, #5).
 *
 * **Generated plans go to the tray.** `suggest_itinerary` writes a draft to
 * `suggestion_tray` and stops. Somebody opens the app, looks at it, and presses
 * accept — and only then does `acceptSuggestion` turn it into real items. It
 * would be one line to insert directly instead. The reason not to is that this
 * is a plan two people share: an assistant that invents a week and writes it in
 * produces a trip nobody agreed to, and the person who did not ask finds out by
 * discovering their evening has moved.
 *
 * **Dictated items are written directly.** "Put dinner at Cafe Younes on the
 * Tuesday" is not generated content — it is one thing the person has already
 * decided, and routing their own sentence through a review queue is ceremony
 * rather than safety. So `add_itinerary_item`, `update_itinerary_item` and
 * `remove_itinerary_item` write straight through.
 *
 * The test that keeps these honest is not "does it insert" — it is which tool
 * does. `suggest_itinerary` must never touch `itinerary_items`, and a caller
 * looping `add_itinerary_item` to build a day has evaded the rule rather than
 * followed it, which is why its description says so in as many words.
 *
 * `suggest_itinerary` also tells the model, explicitly, that the plan was not
 * changed — because a model that believes it wrote will report that it did, and
 * the person only catches that later.
 */
import { z } from 'zod'
import { keyBetween } from '@/lib/fractional'
import type { Json, UpdateDto } from '@/types/database'
import type { TrayDraft, TrayDraftDay } from '@/types/domain'
import { defineTool, requireCouple } from './types'
import type { AnyTool } from './types'

const getItinerary = defineTool({
  name: 'get_itinerary',
  module: 'trips',
  title: 'Get a trip itinerary',
  description:
    'Everything currently planned for a trip, grouped by day, plus anything saved to the trip without a date yet. Read this before suggesting changes so you do not propose something already there.',
  readOnly: true,
  inputSchema: z.object({
    trip_id: z.string().uuid().describe('From list_trips.'),
  }),
  async handler(ctx, input) {
    requireCouple(ctx)

    const { data, error } = await ctx.supabase
      .from('itinerary_items')
      .select('id, title, place_name, scheduled_date, start_time, end_time, state, notes, source')
      .eq('trip_id', input.trip_id)
      .is('deleted_at', null)
      .order('scheduled_date', { ascending: true, nullsFirst: false })
      .order('sort_key', { ascending: true })

    if (error) throw new Error(error.message)
    const items = data ?? []
    if (items.length === 0) return 'Nothing is planned for this trip yet.'

    const byDay = new Map<string, string[]>()
    for (const item of items) {
      const key = item.scheduled_date ?? 'unscheduled'
      const parts: string[] = []
      if (item.start_time) {
        parts.push(item.end_time ? `${item.start_time}–${item.end_time}` : item.start_time)
      }
      parts.push(item.title)
      if (item.place_name && item.place_name !== item.title) parts.push(`at ${item.place_name}`)
      if (item.state && item.state !== 'idea') parts.push(`[${item.state}]`)
      if (item.notes) parts.push(`— ${item.notes}`)

      const list = byDay.get(key) ?? []
      list.push(`  ${parts.join(' · ')}`)
      byDay.set(key, list)
    }

    const lines: string[] = []
    for (const [day, entries] of byDay) {
      lines.push(day === 'unscheduled' ? 'Not yet on a day:' : day)
      lines.push(...entries)
    }
    return lines.join('\n')
  },
})

/**
 * The item shape a caller proposes. Deliberately smaller than `TrayDraftItem`:
 * coordinates, addresses and category ids are things the app resolves from a
 * real place, not things a model should be guessing and writing down as fact.
 */
const draftItemSchema = z.object({
  title: z.string().min(1).describe('What it is. "Lunch at Cafe Younes", "Walk the corniche".'),
  place_name: z.string().nullable().default(null).describe('The venue, if there is a specific one.'),
  notes: z
    .string()
    .nullable()
    .default(null)
    .describe('Why this, or anything worth knowing. Kept verbatim for the person reading it.'),
  url: z.string().url().nullable().default(null).describe('A link, if you have a real one. Never invent one.'),
})

const suggestItinerary = defineTool({
  name: 'suggest_itinerary',
  module: 'trips',
  title: 'Suggest itinerary items',
  description:
    'Propose a day-by-day plan for a trip. IMPORTANT: this does NOT change the itinerary. It places a draft in the suggestion tray for the couple to review, and it only becomes part of their plan when one of them opens the app and accepts it. Tell the person that is what happened — do not report the trip as updated. Leaving days out is encouraged: on a long stay, an empty day is a rest, not a gap to fill.',
  readOnly: false,
  inputSchema: z.object({
    trip_id: z.string().uuid().describe('From list_trips.'),
    note: z
      .string()
      .min(1)
      .describe('One or two sentences on what you were going for. Shown above the draft.'),
    pace: z
      .enum(['relaxed', 'balanced', 'packed'])
      .default('balanced')
      .describe('How full the days are. Shown to the reviewer so they can judge it at a glance.'),
    days: z
      .array(
        z.object({
          date: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .describe('YYYY-MM-DD. Must be a day the trip actually covers.'),
          items: z.array(draftItemSchema).min(1).describe('What you are proposing for that day.'),
        }),
      )
      .min(1)
      .describe(
        'Only the days you are actually proposing something for. Omit a day entirely rather than padding it — days you deliberately skipped belong in open_days.',
      ),
    open_days: z
      .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
      .default([])
      .describe('Days you left blank on purpose. Named so the reviewer sees it was a choice.'),
  }),
  async handler(ctx, input) {
    const coupleId = requireCouple(ctx)

    // The trip must exist and be visible. RLS would refuse the insert anyway,
    // but the error it gives is about a foreign key, and "no trip with that id"
    // is a far more useful thing for a model to read back.
    const { data: trip, error: tripError } = await ctx.supabase
      .from('trips')
      .select('id, title, start_date, end_date')
      .eq('id', input.trip_id)
      .is('deleted_at', null)
      .maybeSingle()
    if (tripError) throw new Error(tripError.message)
    if (!trip) return 'No trip with that id, or it is not one you can see. Nothing was suggested.'

    const days: TrayDraftDay[] = input.days.map((day) => ({
      date: day.date,
      items: day.items.map((item) => ({
        wishlist_id: null,
        title: item.title,
        place_name: item.place_name,
        lat: null,
        lng: null,
        address: null,
        maps_url: null,
        category_id: null,
        notes: item.notes,
        url: item.url,
        // Nobody proposed it. Attribution belongs to the two people using the
        // app, and claiming one of them suggested this would be false.
        proposed_by: null,
      })),
    }))

    const draft: TrayDraft = {
      kind: 'draft',
      pace: input.pace,
      note: input.note,
      days,
      openDays: input.open_days,
    }

    const { error } = await ctx.supabase.from('suggestion_tray').insert({
      couple_id: coupleId,
      trip_id: input.trip_id,
      payload: draft as unknown as Json,
      source: 'ai',
    })
    if (error) throw new Error(error.message)

    const count = days.reduce((sum, day) => sum + day.items.length, 0)
    return [
      `Put a draft in the suggestion tray for ${trip.title}: ${count} item${count === 1 ? '' : 's'} across ${days.length} day${days.length === 1 ? '' : 's'}.`,
      input.open_days.length > 0 ? `Left ${input.open_days.length} day(s) open on purpose.` : null,
      'This is not on the itinerary yet. It appears in the trip’s suggestion tray, and becomes part of the plan only when one of them accepts it there.',
    ]
      .filter(Boolean)
      .join(' ')
  },
})



/**
 * Adding one item directly, which is not a contradiction of the tray rule.
 *
 * Non-negotiable #5 is about *generated* content: a model that invents a
 * week of plans and writes them into a shared itinerary produces a trip nobody
 * agreed to. "Put dinner at Cafe Younes on the Tuesday" is not that — it is the
 * person dictating one thing they have already decided, and routing their own
 * sentence through a review queue is ceremony rather than safety.
 *
 * The line, then: bulk plans go to the tray via `suggest_itinerary`; single
 * named items the person asked for are written here. If you find yourself
 * calling this in a loop to build a day, that is `suggest_itinerary`.
 */
const addItineraryItem = defineTool({
  name: 'add_itinerary_item',
  module: 'trips',
  title: 'Add one plan item',
  description:
    'Add a single item the person has actually asked for, directly to the itinerary. For a generated day-plan use suggest_itinerary instead, which goes to the review tray — do NOT call this repeatedly to build one out.',
  readOnly: false,
  inputSchema: z.object({
    trip_id: z.string().uuid().describe('From list_trips.'),
    title: z.string().min(1).describe('What it is.'),
    scheduled_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .default(null)
      .describe('YYYY-MM-DD, or omit to leave it unscheduled on the trip.'),
    start_time: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .nullable()
      .default(null)
      .describe('HH:MM in the trip’s own local time. Needs a date — a time on no day means nothing.'),
    end_time: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .nullable()
      .default(null)
      .describe('HH:MM in the trip’s local time, if it has a known finish.'),
    place_name: z.string().nullable().default(null).describe('The venue, if there is one.'),
    notes: z.string().nullable().default(null).describe('Anything worth knowing about it.'),
    url: z.string().url().nullable().default(null).describe('A real link only. Never invent one.'),
  }),
  async handler(ctx, input) {
    const coupleId = requireCouple(ctx)

    if (input.start_time && !input.scheduled_date) {
      // The database has a constraint for this; catching it here gives the
      // model something it can act on instead of a Postgres error string.
      return 'A time needs a date. Give scheduled_date as well, or leave the time off.'
    }

    const { data: trip, error: tripError } = await ctx.supabase
      .from('trips')
      .select('id, title')
      .eq('id', input.trip_id)
      .is('deleted_at', null)
      .maybeSingle()
    if (tripError) throw new Error(tripError.message)
    if (!trip) return 'No trip with that id, or it is not one you can see. Nothing was added.'

    // Appended after whatever is already there. One fractional key, so this is
    // a single insert and never a rewrite of siblings.
    const { data: last } = await ctx.supabase
      .from('itinerary_items')
      .select('sort_key')
      .eq('trip_id', input.trip_id)
      .is('deleted_at', null)
      .order('sort_key', { ascending: false })
      .limit(1)
      .maybeSingle()

    const { data, error } = await ctx.supabase
      .from('itinerary_items')
      .insert({
        couple_id: coupleId,
        trip_id: input.trip_id,
        title: input.title,
        scheduled_date: input.scheduled_date,
        start_time: input.start_time,
        end_time: input.end_time,
        place_name: input.place_name,
        notes: input.notes,
        url: input.url,
        proposed_by: ctx.userId,
        source: 'manual',
        sort_key: keyBetween(last?.sort_key ?? null, null),
      })
      .select('id')
      .single()
    if (error) throw new Error(error.message)

    const when = input.scheduled_date
      ? `on ${input.scheduled_date}${input.start_time ? ` at ${input.start_time}` : ''}`
      : 'with no date yet'
    return `Added "${input.title}" to ${trip.title} ${when} (${data.id}).`
  },
})

const updateItineraryItem = defineTool({
  name: 'update_itinerary_item',
  module: 'trips',
  title: 'Change a plan item',
  description:
    'Edit or move one existing item — retitle it, move it to another day or time, or mark it booked or done. Only the fields you pass are touched. Get ids from get_itinerary.',
  readOnly: false,
  inputSchema: z.object({
    item_id: z.string().uuid().describe('From get_itinerary.'),
    title: z.string().min(1).nullable().default(null).describe('Rename it.'),
    scheduled_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .default(null)
      .describe('Move it to this day.'),
    start_time: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .nullable()
      .default(null)
      .describe('HH:MM in the trip’s local time.'),
    end_time: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .nullable()
      .default(null)
      .describe('HH:MM in the trip’s local time.'),
    state: z
      .enum(['idea', 'accepted', 'booked', 'done', 'skipped'])
      .nullable()
      .default(null)
      .describe('Where it has got to. `booked` means paid for or reserved.'),
    notes: z.string().nullable().default(null).describe('Replaces the existing note.'),
  }),
  async handler(ctx, input) {
    requireCouple(ctx)

    const patch: UpdateDto<'itinerary_items'> = {}
    if (input.title !== null) patch.title = input.title
    if (input.scheduled_date !== null) patch.scheduled_date = input.scheduled_date
    if (input.start_time !== null) patch.start_time = input.start_time
    if (input.end_time !== null) patch.end_time = input.end_time
    if (input.state !== null) patch.state = input.state
    if (input.notes !== null) patch.notes = input.notes
    if (Object.keys(patch).length === 0) return 'Nothing to change — no fields were given.'

    const { data, error } = await ctx.supabase
      .from('itinerary_items')
      .update(patch)
      .eq('id', input.item_id)
      .is('deleted_at', null)
      .select('id, title')
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return 'No item with that id, or it is not one you can change.'

    return `Updated "${data.title}": ${Object.keys(patch).join(', ')}.`
  },
})

const removeItineraryItem = defineTool({
  name: 'remove_itinerary_item',
  module: 'trips',
  title: 'Remove a plan item',
  description:
    'Take an item off the itinerary. It is soft-deleted, so it can be restored in the app for thirty days — nothing is destroyed here.',
  readOnly: false,
  inputSchema: z.object({
    item_id: z.string().uuid().describe('From get_itinerary.'),
  }),
  async handler(ctx, input) {
    requireCouple(ctx)

    const { data, error } = await ctx.supabase
      .from('itinerary_items')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', input.item_id)
      .is('deleted_at', null)
      .select('id, title')
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return 'No item with that id, or it was already removed.'

    return `Removed "${data.title}". It is recoverable in the app for thirty days.`
  },
})

export const itineraryTools: AnyTool[] = [
  getItinerary,
  suggestItinerary,
  addItineraryItem,
  updateItineraryItem,
  removeItineraryItem,
]
