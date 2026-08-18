/**
 * Flights: reading bookings, and recording them.
 *
 * A booking is a journey with ordered legs, a direction and a reference, and
 * every field on it is a fact copied off a confirmation email. That is exactly
 * why `add_journey` takes the legs as a list rather than one call per leg — a
 * connection is not two bookings, and splitting it would let a journey exist
 * with half its legs if the second call failed.
 *
 * The risk with writing flights from conversation is precision: a model that
 * fills in a plausible-looking departure time produces something that reads as
 * a booking and is wrong in the details that matter at 5am in a taxi. Two
 * things hold against it. Times are the local clock at the named airport and
 * are converted from that airport's own IANA zone, never the caller's. And a
 * time whose zone we do not know is dropped rather than stored — a missing
 * departure is visibly missing; a wrong one is not.
 *
 * `JourneyBuilder` in the app still takes a pasted confirmation email and
 * parses it, which remains the most accurate route for a real booking.
 */
import { z } from 'zod'
import { tripLocalToUtc } from '@/lib/dates'
import type { UpdateDto } from '@/types/database'
import { defineTool, requireCouple } from './types'
import type { AnyTool } from './types'

const listFlights = defineTool({
  name: 'list_flights',
  module: 'flights',
  title: 'List flights',
  description:
    'Booked flights, grouped by journey, with each leg in order. Times are as scheduled. Use this to answer questions about when someone lands or how long a connection is.',
  readOnly: true,
  inputSchema: z.object({
    trip_id: z.string().uuid().nullable().default(null).describe('Restrict to one trip.'),
    include_past: z.boolean().default(false).describe('Include flights that have already happened.'),
  }),
  async handler(ctx, input) {
    requireCouple(ctx)

    let query = ctx.supabase
      .from('flights')
      .select(
        'id, journey_id, leg_index, flight_number, flight_date, origin_iata, origin_name, dest_iata, dest_name, scheduled_departure, scheduled_arrival, phase, trip_id',
      )
      .is('deleted_at', null)
      .order('flight_date', { ascending: true })
      .order('leg_index', { ascending: true })

    if (input.trip_id) query = query.eq('trip_id', input.trip_id)
    if (!input.include_past) {
      query = query.gte('flight_date', new Date().toISOString().slice(0, 10))
    }

    const { data, error } = await query
    if (error) throw new Error(error.message)
    const flights = data ?? []
    if (flights.length === 0) {
      return input.include_past ? 'No flights recorded.' : 'No upcoming flights.'
    }

    // Legs of one booking belong together. A flight with no journey is a
    // standalone leg and gets a group of its own keyed by its id.
    const groups = new Map<string, typeof flights>()
    for (const flight of flights) {
      const key = flight.journey_id ?? `single:${flight.id}`
      const list = groups.get(key) ?? []
      list.push(flight)
      groups.set(key, list)
    }

    const lines: string[] = []
    for (const legs of groups.values()) {
      const first = legs[0]
      const last = legs[legs.length - 1]
      // Groups are built by pushing, so neither end can be missing. The guard
      // is for the type system rather than for reality.
      if (!first || !last) continue
      const stops = legs.length - 1
      const route = `${first.origin_iata ?? '???'} → ${last.dest_iata ?? '???'}`
      lines.push(
        `${route} on ${first.flight_date}${stops > 0 ? ` · ${stops} stop${stops === 1 ? '' : 's'}` : ' · direct'}`,
      )
      for (const leg of legs) {
        const parts = [
          `  ${leg.flight_number}`,
          `${leg.origin_iata ?? '???'} → ${leg.dest_iata ?? '???'}`,
        ]
        if (leg.scheduled_departure) parts.push(`dep ${leg.scheduled_departure}`)
        if (leg.scheduled_arrival) parts.push(`arr ${leg.scheduled_arrival}`)
        if (leg.phase && leg.phase !== 'scheduled') parts.push(`[${leg.phase}]`)
        lines.push(parts.join(' · '))
      }
    }

    return [
      ...lines,
      '',
      'Departure and arrival times are stored as UTC instants; convert to the airport’s local zone before quoting them to someone.',
    ].join('\n')
  },
})

/**
 * Adding a booking.
 *
 * The single hardest thing to get right here is the times, and it is worth
 * being explicit about why. A flight leaves at 11:25 *in Dubai*, and that
 * sentence means the same thing whoever says it — but this app's users are in
 * different time zones, and an assistant is in none of them. Parsing "11:25"
 * against the caller's clock produces a departure that is wrong by hours and
 * looks perfectly plausible.
 *
 * So times are given as the local wall clock at the airport, and converted
 * using that airport's own IANA zone from the `airports` table. An airport we
 * do not hold saves without coordinates or a zone — the flight still records,
 * it just cannot be drawn on the map or converted, and the tool says so rather
 * than guessing UTC.
 */
const addJourney = defineTool({
  name: 'add_journey',
  module: 'flights',
  title: 'Add a booked journey',
  description:
    'Record a booking as its ordered legs — a direct flight is one leg, a connection is two, and a return trip is a second call with direction "return". Times are the local clock at each airport and are converted automatically. Use this for a flight that is actually booked.',
  readOnly: false,
  inputSchema: z.object({
    trip_id: z
      .string()
      .uuid()
      .nullable()
      .default(null)
      .describe('Attach it to a trip, or omit if it does not belong to one yet.'),
    direction: z
      .enum(['outbound', 'return'])
      .default('outbound')
      .describe('Which way. A return ticket is two calls, one each way.'),
    booking_ref: z
      .string()
      .nullable()
      .default(null)
      .describe('The airline reference, if you have it. Never invent one.'),
    legs: z
      .array(
        z.object({
          flight_number: z.string().min(2).describe('Such as 6E1468. Required.'),
          flight_date: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .describe('The local date of departure at the origin airport.'),
          origin_iata: z.string().length(3).describe('Three-letter IATA code, such as DXB.'),
          dest_iata: z.string().length(3).describe('Three-letter IATA code, such as BOM.'),
          departure_time: z
            .string()
            .regex(/^\d{2}:\d{2}$/)
            .nullable()
            .default(null)
            .describe('HH:MM local at the ORIGIN airport. Not your own clock.'),
          arrival_time: z
            .string()
            .regex(/^\d{2}:\d{2}$/)
            .nullable()
            .default(null)
            .describe('HH:MM local at the DESTINATION airport.'),
        }),
      )
      .min(1)
      .describe('In order of travel. Leg two departs from where leg one landed.'),
  }),
  async handler(ctx, input) {
    const coupleId = requireCouple(ctx)

    const codes = [
      ...new Set(input.legs.flatMap((l) => [l.origin_iata.toUpperCase(), l.dest_iata.toUpperCase()])),
    ]
    const { data: airports, error: airportError } = await ctx.supabase
      .from('airports')
      .select('iata, name, lat, lng, timezone')
      .in('iata', codes)
    if (airportError) throw new Error(airportError.message)

    const known = new Map((airports ?? []).map((a) => [a.iata, a]))
    const unknown = codes.filter((c) => !known.has(c))

    const { data: journey, error: journeyError } = await ctx.supabase
      .from('journeys')
      .insert({
        couple_id: coupleId,
        trip_id: input.trip_id,
        traveler_id: ctx.userId,
        direction: input.direction,
        booking_ref: input.booking_ref,
      })
      .select('id')
      .single()
    if (journeyError) throw new Error(journeyError.message)

    const rows = input.legs.map((leg, index) => {
      const origin = known.get(leg.origin_iata.toUpperCase())
      const dest = known.get(leg.dest_iata.toUpperCase())

      return {
        couple_id: coupleId,
        trip_id: input.trip_id,
        journey_id: journey.id,
        leg_index: index,
        traveler_id: ctx.userId,
        created_by: ctx.userId,
        flight_number: leg.flight_number.toUpperCase().replace(/\s+/g, ''),
        flight_date: leg.flight_date,
        origin_iata: leg.origin_iata.toUpperCase(),
        dest_iata: leg.dest_iata.toUpperCase(),
        origin_name: origin?.name ?? null,
        dest_name: dest?.name ?? null,
        origin_lat: origin?.lat ?? null,
        origin_lng: origin?.lng ?? null,
        dest_lat: dest?.lat ?? null,
        dest_lng: dest?.lng ?? null,
        origin_tz: origin?.timezone ?? null,
        dest_tz: dest?.timezone ?? null,
        // Converted from the airport's own zone, never the caller's. Without a
        // known zone the time is dropped rather than stored as a wrong instant:
        // a missing departure is visibly missing, a wrong one is not.
        scheduled_departure:
          leg.departure_time && origin?.timezone
            ? tripLocalToUtc(leg.flight_date, leg.departure_time, origin.timezone).toISOString()
            : null,
        scheduled_arrival:
          leg.arrival_time && dest?.timezone
            ? tripLocalToUtc(leg.flight_date, leg.arrival_time, dest.timezone).toISOString()
            : null,
      }
    })

    const { error } = await ctx.supabase.from('flights').insert(rows)
    if (error) throw new Error(error.message)

    const route = `${rows[0]!.origin_iata} → ${rows[rows.length - 1]!.dest_iata}`
    const stops = rows.length - 1
    return [
      `Saved ${input.direction} ${route} on ${rows[0]!.flight_date}`,
      stops > 0 ? ` with ${stops} stop${stops === 1 ? '' : 's'}` : ' direct',
      ` (journey ${journey.id}).`,
      unknown.length
        ? ` ${unknown.join(', ')} ${unknown.length === 1 ? 'is' : 'are'} not in the airport list, so those legs have no coordinates and their times were left unset — add them in the app.`
        : '',
    ].join('')
  },
})

const updateFlight = defineTool({
  name: 'update_flight',
  module: 'flights',
  title: 'Change a flight',
  description:
    'Correct one leg of a booking — its number, its date, or its scheduled times. Times are the local clock at the relevant airport. Get ids from list_flights.',
  readOnly: false,
  inputSchema: z.object({
    flight_id: z.string().uuid().describe('From list_flights.'),
    flight_number: z.string().min(2).nullable().default(null).describe('Corrected flight number.'),
    flight_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .default(null)
      .describe('Corrected local date of departure.'),
    departure_time: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .nullable()
      .default(null)
      .describe('HH:MM local at the origin airport.'),
    arrival_time: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .nullable()
      .default(null)
      .describe('HH:MM local at the destination airport.'),
  }),
  async handler(ctx, input) {
    requireCouple(ctx)

    const { data: flight, error: loadError } = await ctx.supabase
      .from('flights')
      .select('id, flight_number, flight_date, origin_tz, dest_tz')
      .eq('id', input.flight_id)
      .is('deleted_at', null)
      .maybeSingle()
    if (loadError) throw new Error(loadError.message)
    if (!flight) return 'No flight with that id, or it is not one you can change.'

    const patch: UpdateDto<'flights'> = {}
    if (input.flight_number !== null) {
      patch.flight_number = input.flight_number.toUpperCase().replace(/\s+/g, '')
    }
    const date = input.flight_date ?? flight.flight_date
    if (input.flight_date !== null) patch.flight_date = input.flight_date

    if (input.departure_time !== null) {
      if (!flight.origin_tz) return 'That flight has no origin timezone, so a local time cannot be converted. Set the airport in the app first.'
      patch.scheduled_departure = tripLocalToUtc(date, input.departure_time, flight.origin_tz).toISOString()
    }
    if (input.arrival_time !== null) {
      if (!flight.dest_tz) return 'That flight has no destination timezone, so a local time cannot be converted. Set the airport in the app first.'
      patch.scheduled_arrival = tripLocalToUtc(date, input.arrival_time, flight.dest_tz).toISOString()
    }

    if (Object.keys(patch).length === 0) return 'Nothing to change — no fields were given.'

    const { error } = await ctx.supabase.from('flights').update(patch).eq('id', input.flight_id)
    if (error) throw new Error(error.message)

    return `Updated ${patch.flight_number ?? flight.flight_number}: ${Object.keys(patch).join(', ')}.`
  },
})

const removeFlight = defineTool({
  name: 'remove_flight',
  module: 'flights',
  title: 'Remove a flight',
  description:
    'Take one leg off a booking. Soft-deleted, so it is recoverable in the app for thirty days.',
  readOnly: false,
  inputSchema: z.object({
    flight_id: z.string().uuid().describe('From list_flights.'),
  }),
  async handler(ctx, input) {
    requireCouple(ctx)
    const { data, error } = await ctx.supabase
      .from('flights')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', input.flight_id)
      .is('deleted_at', null)
      .select('flight_number')
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return 'No flight with that id, or it was already removed.'
    return `Removed ${data.flight_number}. Recoverable in the app for thirty days.`
  },
})

export const flightTools: AnyTool[] = [listFlights, addJourney, updateFlight, removeFlight]
