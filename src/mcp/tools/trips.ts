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
import {
  buildJourney,
  describeTripJourney,
  journeyCentre,
  nearbyWishlist,
} from '@/modules/trips/journey'
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



/**
 * The whole trip as one picture — the same one the app's journey screen draws.
 *
 * Assembling this from `get_trip`, `list_flights`, `list_itinerary` and
 * `list_destinations` was possible before, and it took four calls plus a
 * merge the model had to get right — including the two ordering rules
 * (`journey.ts`) that are easy to get subtly wrong. Doing it here means the
 * assistant and the screen are looking at the same trip, assembled by the same
 * function, and it costs one call.
 *
 * Read-only and deliberately dense: it is the call to make before suggesting
 * anything, because it says which days are already busy, which are travel days,
 * and which were left blank on purpose.
 */
const getTripJourney = defineTool({
  name: 'get_trip_journey',
  module: 'trips',
  title: 'See the whole trip',
  description:
    "The whole trip in one read: every day in order, with flights, planned items, and which destination the couple is at. Also lists saved places near the trip that are not on the plan yet. Call this before suggesting anything — it says which days are travel days and which were deliberately left blank ('kept clear'), and a suggestion that lands on either is one the couple will reject.",
  readOnly: true,
  inputSchema: z.object({
    trip_id: z.string().uuid().describe('From list_trips.'),
  }),
  async handler(ctx, input) {
    const coupleId = requireCouple(ctx)

    const [trip, days, flights, items, destinations, wishlist] = await Promise.all([
      ctx.supabase
        .from('trips')
        .select('id, title, start_date, end_date, date_precision, is_open_ended, timezone, notes')
        .eq('id', input.trip_id)
        .is('deleted_at', null)
        .maybeSingle(),
      ctx.supabase
        .from('trip_days')
        .select('date, day_type, title, note')
        .eq('trip_id', input.trip_id)
        .order('date', { ascending: true }),
      ctx.supabase
        .from('flights')
        .select(
          'id, flight_number, flight_date, origin_iata, dest_iata, origin_lat, origin_lng, dest_lat, dest_lng, scheduled_departure, scheduled_arrival',
        )
        .eq('trip_id', input.trip_id),
      ctx.supabase
        .from('itinerary_items')
        .select('id, title, scheduled_date, start_time, place_name, state, lat, lng')
        .eq('trip_id', input.trip_id)
        .is('deleted_at', null),
      ctx.supabase
        .from('trip_destinations')
        .select('city, arrive_on, depart_on, lat, lng, state')
        .eq('trip_id', input.trip_id),
      ctx.supabase
        .from('wishlist_items')
        .select('id, title, lat, lng')
        .eq('couple_id', coupleId)
        .is('deleted_at', null),
    ])

    if (trip.error) throw new Error(trip.error.message)
    if (!trip.data) return 'No trip with that id, or it is not one you can see.'
    for (const result of [days, flights, items, destinations, wishlist]) {
      if (result.error) throw new Error(result.error.message)
    }

    const journey = buildJourney({
      startDate: trip.data.start_date,
      endDate: trip.data.end_date,
      days: days.data ?? [],
      flights: flights.data ?? [],
      items: items.data ?? [],
      destinations: destinations.data ?? [],
    })

    const lines = [describeTrip(trip.data), describeTripJourney(journey)]
    if (journey.days.length === 0) {
      lines.push('', 'No dates on this trip yet, so there is nothing laid out.')
      return lines.join('\n')
    }

    lines.push('')
    for (const day of journey.days) {
      const header = [`Day ${day.index}`, day.date]
      if (day.place) header.push(day.place)
      if (day.title) header.push(day.title)
      // Said in words, because these are the two states a suggestion must
      // respect and neither is obvious from a list of items that is empty.
      if (day.isRest) header.push('kept clear on purpose — do not fill this')
      else if (day.isOpen) header.push('open')
      lines.push(header.join(' · '))

      if (day.note) lines.push(`    note: ${day.note}`)
      for (const entry of day.entries) {
        if (entry.kind === 'item') {
          const parts = [entry.time?.slice(0, 5) ?? '—', entry.title]
          if (entry.placeName && entry.placeName !== entry.title) parts.push(entry.placeName)
          if (entry.state && entry.state !== 'accepted') parts.push(`[${entry.state}]`)
          lines.push(`    ${parts.join(' · ')}`)
        } else {
          const verb = entry.kind === 'arrive' ? 'lands' : 'departs'
          lines.push(`    ${entry.flightNumber} ${verb} ${entry.airport ?? ''}`.trimEnd())
        }
      }
    }

    const nearby = nearbyWishlist(
      wishlist.data ?? [],
      journeyCentre(journey),
      (items.data ?? []).map((i) => i.title),
    )
    if (nearby.length > 0) {
      lines.push('', 'Saved places near this trip, not yet on the plan:')
      for (const { item, km } of nearby.slice(0, 10)) {
        lines.push(`  - ${item.title} (${Math.round(km)} km) — wishlist id ${item.id}`)
      }
      lines.push(
        'Use add_itinerary_item to put one on a day, or leave them; nothing here is added on its own.',
      )
    }

    return lines.join('\n')
  },
})

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

export const tripTools: AnyTool[] = [
  listTrips,
  getTrip,
  getTripJourney,
  createTrip,
  updateTrip,
  setTripDay,
]
