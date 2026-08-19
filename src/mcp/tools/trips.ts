/**
 * Reading trips. The entry point for almost every conversation, because
 * everything else hangs off a trip id.
 *
 * These render to text rather than JSON on purpose (see `types.ts`). The
 * formatting carries information the raw columns do not: an open-ended trip
 * says so in words instead of leaving a model to infer it from a null
 * `end_date`, and a date-precision of `month` is stated rather than being
 * silently rendered as the first of the month.
 */
import { z } from 'zod'
import type { UpdateDto } from '@/types/database'
import { defineTool, requireCouple } from './types'
import type { AnyTool } from './types'

/** Trips a model should see first: not deleted, soonest first. */
const listTrips = defineTool({
  name: 'list_trips',
  module: 'trips',
  title: 'List trips',
  description:
    'Every trip in the shared plan, with its dates and status. Start here — other tools need a trip id, and this is where the ids come from.',
  readOnly: true,
  inputSchema: z.object({
    include_past: z
      .boolean()
      .default(false)
      .describe('Include trips that have already finished. Defaults to upcoming and current only.'),
  }),
  async handler(ctx, input) {
    requireCouple(ctx)

    let query = ctx.supabase
      .from('trips')
      .select('id, title, start_date, end_date, date_precision, is_open_ended, timezone, notes')
      .is('deleted_at', null)
      .order('start_date', { ascending: true, nullsFirst: false })

    if (!input.include_past) {
      const today = new Date().toISOString().slice(0, 10)
      // An open-ended trip has no end to have passed, so it is never filtered
      // out by date — it is current until somebody says otherwise.
      query = query.or(`end_date.gte.${today},end_date.is.null`)
    }

    const { data, error } = await query
    if (error) throw new Error(error.message)
    if (!data?.length) {
      return input.include_past
        ? 'There are no trips yet.'
        : 'No current or upcoming trips. Call again with include_past to see finished ones.'
    }

    return data.map(describeTrip).join('\n')
  },
})

const getTrip = defineTool({
  name: 'get_trip',
  module: 'trips',
  title: 'Get one trip',
  description:
    'One trip in full: its dates, its day-by-day structure, and any notes on individual days. Use this before suggesting an itinerary, so the suggestion lands on days that exist.',
  readOnly: true,
  inputSchema: z.object({
    trip_id: z.string().uuid().describe('From list_trips.'),
  }),
  async handler(ctx, input) {
    requireCouple(ctx)

    const [tripResult, daysResult] = await Promise.all([
      ctx.supabase
        .from('trips')
        .select('id, title, start_date, end_date, date_precision, is_open_ended, timezone, notes')
        .eq('id', input.trip_id)
        .is('deleted_at', null)
        .maybeSingle(),
      ctx.supabase
        .from('trip_days')
        .select('date, title, day_type, note')
        .eq('trip_id', input.trip_id)
        .order('date', { ascending: true }),
    ])

    if (tripResult.error) throw new Error(tripResult.error.message)
    if (!tripResult.data) return 'No trip with that id, or it is not one you can see.'
    if (daysResult.error) throw new Error(daysResult.error.message)

    const lines = [describeTrip(tripResult.data)]
    const days = daysResult.data ?? []

    if (days.length === 0) {
      lines.push('No days have been laid out yet.')
    } else {
      lines.push('', `Days (${days.length}):`)
      for (const day of days) {
        const parts = [day.date]
        if (day.title) parts.push(day.title)
        // `rest` is the app's word for a day deliberately left blank. A model
        // that does not know this will try to fill it, which is the one thing
        // those days exist to prevent.
        if (day.day_type && day.day_type !== 'normal') parts.push(`[${day.day_type}]`)
        if (day.note) parts.push(`— ${day.note}`)
        lines.push(`  ${parts.join(' · ')}`)
      }
    }

    return lines.join('\n')
  },
})

interface TripRow {
  id: string
  title: string
  start_date: string | null
  end_date: string | null
  date_precision: string | null
  is_open_ended: boolean | null
  timezone: string | null
  notes: string | null
}

function describeTrip(trip: TripRow): string {
  const parts: string[] = [`${trip.title} (${trip.id})`]

  if (!trip.start_date) {
    parts.push('no dates yet')
  } else if (trip.is_open_ended) {
    parts.push(`from ${trip.start_date}, open-ended`)
  } else if (trip.end_date) {
    parts.push(`${trip.start_date} → ${trip.end_date}`)
  } else {
    parts.push(trip.start_date)
  }

  // Stated rather than implied: a `month` precision trip has a start_date of
  // the 1st that nobody chose, and a model should not plan around it.
  if (trip.date_precision && trip.date_precision !== 'exact') {
    parts.push(`dates known only to the ${trip.date_precision}`)
  }
  if (trip.timezone) parts.push(trip.timezone)
  if (trip.notes) parts.push(`note: ${trip.notes}`)

  return `- ${parts.join(' · ')}`
}



const createTrip = defineTool({
  name: 'create_trip',
  module: 'trips',
  title: 'Create a trip',
  description:
    'Start a new trip. Writes immediately — this is the person telling you about a trip they are taking. Dates are optional: a trip with no dates yet is a normal state, and guessing them is worse than leaving them empty.',
  readOnly: false,
  inputSchema: z.object({
    title: z.string().min(1).describe('What they call it. "Mangalore in December".'),
    start_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .default(null)
      .describe('YYYY-MM-DD. Omit if not settled.'),
    end_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .default(null)
      .describe('YYYY-MM-DD. Omit for an open-ended trip.'),
    date_precision: z
      .enum(['exact', 'month', 'season', 'year', 'unknown'])
      .default('unknown')
      .describe(
        'How firm the dates are. Say `month` for "sometime in December" rather than inventing a day and calling it exact.',
      ),
    is_open_ended: z.boolean().default(false).describe('True when there is no return date yet.'),
    notes: z.string().nullable().default(null).describe('Anything worth recording about it.'),
  }),
  async handler(ctx, input) {
    const coupleId = requireCouple(ctx)

    const { data, error } = await ctx.supabase
      .from('trips')
      .insert({
        couple_id: coupleId,
        title: input.title,
        start_date: input.start_date,
        end_date: input.end_date,
        date_precision: input.date_precision,
        is_open_ended: input.is_open_ended,
        notes: input.notes,
        created_by: ctx.userId,
      })
      .select('id, title')
      .single()
    if (error) throw new Error(error.message)

    // The per-day rows the plan hangs off. Done by RPC because the date maths
    // belongs next to the constraint that enforces it, not in a tool.
    if (input.start_date) {
      const { error: syncError } = await ctx.supabase.rpc('sync_trip_days', { target: data.id })
      if (syncError) throw new Error(syncError.message)
    }

    return `Created "${data.title}" (${data.id}).${input.start_date ? '' : ' No dates yet — add them when they are settled.'}`
  },
})

const updateTrip = defineTool({
  name: 'update_trip',
  module: 'trips',
  title: 'Update a trip',
  description:
    'Change a trip’s title, dates or notes. Only the fields you pass are touched. Changing the dates rebuilds the day list, which can leave items stranded on days that no longer exist — check get_trip afterwards if you shortened it.',
  readOnly: false,
  inputSchema: z.object({
    trip_id: z.string().uuid().describe('From list_trips.'),
    title: z.string().min(1).nullable().default(null).describe('New title, or omit to leave it.'),
    start_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .default(null)
      .describe('New start date, YYYY-MM-DD. Omit to leave it as it is.'),
    end_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .default(null)
      .describe('New end date, YYYY-MM-DD. Omit to leave it as it is.'),
    date_precision: z
      .enum(['exact', 'month', 'season', 'year', 'unknown'])
      .nullable()
      .default(null)
      .describe('How firm the dates now are.'),
    notes: z.string().nullable().default(null).describe('Replaces the existing note.'),
  }),
  async handler(ctx, input) {
    requireCouple(ctx)

    // Null means "leave alone" rather than "clear", because a model that
    // omits a field must not wipe it. Clearing a date is done in the app.
    // Typed, so a mistyped column name is a compile error rather than a
    // PostgREST request that silently updates nothing.
    const patch: UpdateDto<'trips'> = {}
    if (input.title !== null) patch.title = input.title
    if (input.start_date !== null) patch.start_date = input.start_date
    if (input.end_date !== null) patch.end_date = input.end_date
    if (input.date_precision !== null) patch.date_precision = input.date_precision
    if (input.notes !== null) patch.notes = input.notes

    if (Object.keys(patch).length === 0) return 'Nothing to change — no fields were given.'

    const { data, error } = await ctx.supabase
      .from('trips')
      .update(patch)
      .eq('id', input.trip_id)
      .is('deleted_at', null)
      .select('id, title, start_date')
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return 'No trip with that id, or it is not one you can change. Nothing was updated.'

    if (patch.start_date || patch.end_date) {
      const { error: syncError } = await ctx.supabase.rpc('sync_trip_days', { target: input.trip_id })
      if (syncError) throw new Error(syncError.message)
    }

    return `Updated "${data.title}": ${Object.keys(patch).join(', ')}.`
  },
})

const setTripDay = defineTool({
  name: 'set_trip_day',
  module: 'trips',
  title: 'Mark a day',
  description:
    'Give one day of a trip a type, title or note. Marking a day as `rest` is how this app says "leave this blank on purpose" — on a long stay an empty day is the point of the trip, not a gap to be filled, so prefer marking a day rest over inventing something to put on it.',
  readOnly: false,
  inputSchema: z.object({
    trip_id: z.string().uuid().describe('From list_trips.'),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .describe('A day the trip already covers — see get_trip.'),
    day_type: z
      .enum(['travel', 'planned', 'open', 'rest', 'work'])
      .nullable()
      .default(null)
      .describe('`rest` means deliberately blank. `open` means simply nothing planned yet.'),
    title: z.string().nullable().default(null).describe('A name for the day.'),
    note: z.string().nullable().default(null).describe('A note for that day.'),
  }),
  async handler(ctx, input) {
    requireCouple(ctx)

    const patch: UpdateDto<'trip_days'> = {}
    if (input.day_type !== null) patch.day_type = input.day_type
    if (input.title !== null) patch.title = input.title
    if (input.note !== null) patch.note = input.note
    if (Object.keys(patch).length === 0) return 'Nothing to change — no fields were given.'

    const { data, error } = await ctx.supabase
      .from('trip_days')
      .update(patch)
      .eq('trip_id', input.trip_id)
      .eq('date', input.date)
      .select('date')
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return `The trip has no day on ${input.date}. Check get_trip for the days it covers.`

    return `Marked ${input.date}: ${Object.keys(patch).join(', ')}.`
  },
})

export const tripTools: AnyTool[] = [listTrips, getTrip, createTrip, updateTrip, setTripDay]
