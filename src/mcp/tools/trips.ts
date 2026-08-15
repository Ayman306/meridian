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

export const tripTools: AnyTool[] = [listTrips, getTrip]
