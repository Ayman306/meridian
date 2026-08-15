/**
 * Flights, read-only.
 *
 * No write tool here, and that is a considered omission rather than an
 * unfinished one. A booking is a journey with ordered legs, a direction and a
 * reference, and every field on it is a fact copied off a confirmation email —
 * dates, times in the airport's own zone, terminals. A model filling that in
 * from conversation produces something that looks like a booking and is wrong
 * in the details that matter at 5am in a taxi. `JourneyBuilder` in the app
 * takes a pasted confirmation and parses it, which is both faster and honest
 * about where the data came from.
 */
import { z } from 'zod'
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

export const flightTools: AnyTool[] = [listFlights]
