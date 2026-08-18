/**
 * Where a trip might go, and where it settled.
 *
 * A destination is a candidate until somebody chooses it, which is the point of
 * the module: two people shortlist places and then agree. So `add_destination`
 * always lands as a candidate, never as chosen. An assistant that could mark a
 * place chosen would be casting one of the two votes that decision is made of.
 *
 * Choosing is still available as its own tool, because "we've decided on
 * Mangalore" is a thing a person says — but it is a separate, deliberate call
 * rather than a flag on the one that adds it.
 */
import { z } from 'zod'
import { keyBetween } from '@/lib/fractional'
import { defineTool, requireCouple } from './types'
import type { AnyTool } from './types'

const listDestinations = defineTool({
  name: 'list_destinations',
  module: 'destinations',
  title: 'List destinations',
  description:
    'The places under consideration for a trip, and which one was chosen. Read this before suggesting an itinerary — a plan for the wrong city is worse than no plan.',
  readOnly: true,
  inputSchema: z.object({
    trip_id: z.string().uuid().describe('From list_trips.'),
  }),
  async handler(ctx, input) {
    requireCouple(ctx)

    const { data, error } = await ctx.supabase
      .from('trip_destinations')
      .select('id, city, country_code, state, arrive_on, depart_on, timezone, notes')
      .eq('trip_id', input.trip_id)
      .is('deleted_at', null)
      .order('sort_key', { ascending: true })
    if (error) throw new Error(error.message)

    const rows = data ?? []
    if (rows.length === 0) return 'No destinations on this trip yet.'

    return rows
      .map((row) => {
        const parts = [`${row.city}${row.country_code ? `, ${row.country_code}` : ''} (${row.id})`]
        parts.push(row.state)
        if (row.arrive_on) parts.push(`${row.arrive_on}${row.depart_on ? ` → ${row.depart_on}` : ''}`)
        if (row.timezone) parts.push(row.timezone)
        if (row.notes) parts.push(`— ${row.notes}`)
        return `- ${parts.join(' · ')}`
      })
      .join('\n')
  },
})

const addDestination = defineTool({
  name: 'add_destination',
  module: 'destinations',
  title: 'Add a candidate destination',
  description:
    'Put a place on the shortlist for a trip. It lands as a candidate — deciding between candidates is something the two of them do, so this never marks anything chosen.',
  readOnly: false,
  inputSchema: z.object({
    trip_id: z.string().uuid().describe('From list_trips.'),
    city: z.string().min(1).describe('The city or place.'),
    country_code: z
      .string()
      .length(2)
      .nullable()
      .default(null)
      .describe('ISO 3166-1 alpha-2, uppercase. Omit rather than guessing.'),
    arrive_on: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .default(null)
      .describe('YYYY-MM-DD, if this leg has dates.'),
    depart_on: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .default(null)
      .describe('YYYY-MM-DD, if this leg has dates.'),
    notes: z.string().nullable().default(null).describe('Why it is worth considering.'),
  }),
  async handler(ctx, input) {
    const coupleId = requireCouple(ctx)

    const { data: last } = await ctx.supabase
      .from('trip_destinations')
      .select('sort_key')
      .eq('trip_id', input.trip_id)
      .is('deleted_at', null)
      .order('sort_key', { ascending: false })
      .limit(1)
      .maybeSingle()

    const { data, error } = await ctx.supabase
      .from('trip_destinations')
      .insert({
        couple_id: coupleId,
        trip_id: input.trip_id,
        city: input.city,
        country_code: input.country_code?.toUpperCase() ?? null,
        arrive_on: input.arrive_on,
        depart_on: input.depart_on,
        notes: input.notes,
        state: 'candidate',
        created_by: ctx.userId,
        sort_key: keyBetween(last?.sort_key ?? null, null),
      })
      .select('id')
      .single()
    if (error) throw new Error(error.message)

    return `Added ${input.city} as a candidate (${data.id}). Choose between candidates in the app.`
  },
})

const chooseDestination = defineTool({
  name: 'choose_destination',
  module: 'destinations',
  title: 'Choose a destination',
  description:
    'Mark a candidate as the one they settled on. Only call this when the person has actually said they decided — it is their choice to make, not one to infer from enthusiasm.',
  readOnly: false,
  inputSchema: z.object({
    destination_id: z.string().uuid().describe('From list_destinations.'),
  }),
  async handler(ctx, input) {
    requireCouple(ctx)

    // The RPC rather than a plain update: choosing one destination has effects
    // on its siblings, and that logic belongs in one place next to the data.
    const { error } = await ctx.supabase.rpc('choose_destination', {
      destination_id: input.destination_id,
    })
    if (error) throw new Error(error.message)

    return 'Marked as chosen.'
  },
})

export const destinationTools: AnyTool[] = [listDestinations, addDestination, chooseDestination]
