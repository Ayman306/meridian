/**
 * Reading the plan, and proposing changes to it.
 *
 * The asymmetry here is the point and is not negotiable (spec Part 15, #5).
 * Reads are direct. Writes are not: `suggest_itinerary` puts a draft in the
 * suggestion tray and stops. Somebody opens the app, looks at it, and presses
 * accept — and only then does `acceptSuggestion` turn it into real items.
 *
 * It would be one line to insert into `itinerary_items` from here. The reason
 * not to is that this is a plan two people share. An assistant that quietly
 * rewrites it produces a trip nobody agreed to, and the person who did not ask
 * for the change finds out by discovering their evening has moved. The tray
 * costs one tap and makes every generated change something a human said yes to.
 *
 * The tool description tells the model this explicitly, because a model that
 * believes it wrote to the plan will report back that the plan was updated —
 * and that would be a lie the person only catches later.
 */
import { z } from 'zod'
import type { TrayDraft, TrayDraftDay } from '@/types/domain'
import type { Json } from '@/types/database'
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

export const itineraryTools: AnyTool[] = [getItinerary, suggestItinerary]
