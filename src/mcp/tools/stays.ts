/**
 * Where they sleep.
 *
 * Filed under the `trips` module rather than getting a scope of its own: a
 * booking is part of a trip, and a token trusted to read the trip is the same
 * token that should be able to answer "which hotel are we in on Thursday". A
 * separate scope would be a permission nobody would think to grant and every
 * useful question would need.
 *
 * ## The booking reference never leaves the app
 *
 * `booking_ref` is the one thing you cannot reconstruct from memory at a front
 * desk at 1am. It is also exactly the shape of thing that should not sit in a
 * model's context — so no query here selects it, asserted in
 * `registry.test.ts`, for the same reason document numbers are omitted. A
 * question that genuinely needs it is a question for the app.
 *
 * ## check_out is exclusive
 *
 * Stated in the tool descriptions as well as here, because a model writing
 * "three nights from the 4th" as `check_in: 04, check_out: 06` has booked two.
 * The database refuses `check_out <= check_in`, which catches the zero-night
 * case and not the off-by-one.
 */
import { z } from 'zod'
import type { UpdateDto } from '@/types/database'
import { parseGoogleMapsLink, googleMapsUrlFor } from '@/lib/maps/googleMaps'
import { defineTool, locate, requireCouple } from './types'
import type { AnyTool } from './types'

/** Everything a question about a stay can need, and not the booking reference. */
const SAFE_COLUMNS = 'id, name, kind, check_in, check_out, address, city, country_code, url, phone, notes'

const DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe('YYYY-MM-DD.')

const listStays = defineTool({
  name: 'list_stays',
  module: 'trips',
  title: 'List accommodation',
  description:
    'Where the couple is sleeping on a trip, with dates and addresses. check_out is exclusive: a stay from the 4th to the 7th is three nights, and the 7th is the morning they leave. Booking references are deliberately not returned — those stay in the app.',
  readOnly: true,
  inputSchema: z.object({
    trip_id: z.string().uuid().describe('From list_trips.'),
  }),
  async handler(ctx, input) {
    requireCouple(ctx)

    const { data, error } = await ctx.supabase
      .from('accommodations')
      .select(SAFE_COLUMNS)
      .eq('trip_id', input.trip_id)
      .is('deleted_at', null)
      .order('check_in', { ascending: true, nullsFirst: false })
    if (error) throw new Error(error.message)

    const rows = data ?? []
    if (rows.length === 0) return 'Nowhere booked on this trip yet.'

    return rows.map((row) => `- ${describeStay(row)}`).join('\n')
  },
})

const addStay = defineTool({
  name: 'add_stay',
  module: 'trips',
  title: 'Add a place to stay',
  description:
    'Record where the couple is staying. check_out is EXCLUSIVE — three nights from the 4th is check_in 2026-06-04 and check_out 2026-06-07. Getting this wrong books a night they do not have. Give locate_query or a maps link and the server attaches the real address and pin; never pass coordinates, this tool does not take them.',
  readOnly: false,
  inputSchema: z.object({
    trip_id: z.string().uuid().describe('From list_trips.'),
    name: z.string().min(1).describe('What the place is called.'),
    kind: z
      .enum(['hotel', 'apartment', 'guesthouse', 'family', 'other'])
      .default('hotel')
      .describe('What sort of place it is.'),
    check_in: DATE.nullable().default(null).describe('The first night. YYYY-MM-DD.'),
    check_out: DATE.nullable()
      .default(null)
      .describe('The morning they leave — exclusive, so it is the night after the last one.'),
    maps_url: z
      .string()
      .url()
      .nullable()
      .default(null)
      .describe('A Google Maps link, if the person gave you one. The pin is read out of it.'),
    locate_query: z
      .string()
      .nullable()
      .default(null)
      .describe(
        'The hotel to look up, as specifically as you can — "Pensão Alfama, Rua dos Remédios, Lisbon". The server geocodes it and attaches the real address and pin. Use it whenever there is no map link.',
      ),
    notes: z.string().nullable().default(null).describe('Anything worth remembering about it.'),
  }),
  async handler(ctx, input) {
    const coupleId = requireCouple(ctx)

    if (input.check_in && input.check_out && input.check_out <= input.check_in) {
      return `check_out has to be after check_in — a stay covers nights, not days. For a stay on ${input.check_in}, check_out is the morning they leave.`
    }

    const parsed = input.maps_url ? parseGoogleMapsLink(input.maps_url) : null
    const located =
      parsed?.lat === undefined || parsed?.lat === null
        ? await locate(input.locate_query ?? input.name)
        : null

    const lat = parsed?.lat ?? located?.lat ?? null
    const lng = parsed?.lng ?? located?.lng ?? null

    const { data, error } = await ctx.supabase
      .from('accommodations')
      .insert({
        couple_id: coupleId,
        trip_id: input.trip_id,
        created_by: ctx.userId,
        name: input.name,
        kind: input.kind,
        check_in: input.check_in,
        check_out: input.check_out,
        notes: input.notes,
        lat,
        lng,
        address: located?.address ?? null,
        city: located?.city ?? null,
        country_code: located?.countryCode ?? null,
        maps_url:
          lat !== null && lng !== null
            ? googleMapsUrlFor(lat, lng, input.name)
            : (input.maps_url ?? null),
      })
      .select(SAFE_COLUMNS)
      .single()
    if (error) throw new Error(error.message)

    const found = lat !== null ? '' : ' No pin — nothing matched the search, so the map will not show it until somebody sets it in the app.'
    return `Added ${describeStay(data)}.${found}`
  },
})

const updateStay = defineTool({
  name: 'update_stay',
  module: 'trips',
  title: 'Change a booking',
  description:
    'Change the dates, name or notes of a stay. Only the fields you pass change. Remember check_out is exclusive. To move where it is, pass locate_query — coordinates are never accepted.',
  readOnly: false,
  inputSchema: z.object({
    stay_id: z.string().uuid().describe('From list_stays.'),
    name: z.string().nullable().default(null).describe('A new name.'),
    check_in: DATE.nullable().default(null).describe('A new first night.'),
    check_out: DATE.nullable().default(null).describe('A new leaving morning — exclusive.'),
    notes: z.string().nullable().default(null).describe('Replaces the note.'),
    locate_query: z
      .string()
      .nullable()
      .default(null)
      .describe('Look the place up again and replace its address and pin.'),
  }),
  async handler(ctx, input) {
    requireCouple(ctx)

    const patch: UpdateDto<'accommodations'> = {}
    if (input.name !== null) patch.name = input.name
    if (input.check_in !== null) patch.check_in = input.check_in
    if (input.check_out !== null) patch.check_out = input.check_out
    if (input.notes !== null) patch.notes = input.notes

    if (input.locate_query !== null) {
      const located = await locate(input.locate_query)
      if (located.lat === null || located.lng === null) {
        return `Nothing matched "${input.locate_query}", so the pin was left as it was. Nothing else was changed either — try a more specific search.`
      }
      patch.lat = located.lat
      patch.lng = located.lng
      patch.address = located.address
      patch.city = located.city
      patch.country_code = located.countryCode
      patch.maps_url = googleMapsUrlFor(located.lat, located.lng, input.name ?? located.name ?? 'Stay')
    }

    if (Object.keys(patch).length === 0) return 'Nothing to change — no fields were given.'

    const { data, error } = await ctx.supabase
      .from('accommodations')
      .update(patch)
      .eq('id', input.stay_id)
      .is('deleted_at', null)
      .select(SAFE_COLUMNS)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return 'No stay with that id, or it is not one you can change.'

    return `Updated ${describeStay(data)}.`
  },
})

const removeStay = defineTool({
  name: 'remove_stay',
  module: 'trips',
  title: 'Remove a booking',
  description:
    'Take a stay off the trip. It goes to the bin rather than being erased, because a booking reference is not something anybody can remember back.',
  readOnly: false,
  inputSchema: z.object({
    stay_id: z.string().uuid().describe('From list_stays.'),
  }),
  async handler(ctx, input) {
    requireCouple(ctx)

    const { data, error } = await ctx.supabase
      .from('accommodations')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', input.stay_id)
      .is('deleted_at', null)
      .select('name')
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return 'No stay with that id, or it was already removed.'

    return `Removed ${data.name}. It is recoverable in the app.`
  },
})

interface StayRow {
  id: string
  name: string
  kind: string
  check_in: string | null
  check_out: string | null
  address: string | null
  city: string | null
  notes: string | null
}

/** Nights stated in words, because that is the number a person is thinking in. */
function describeStay(row: StayRow): string {
  const parts = [`${row.name} (${row.id})`, row.kind]

  if (row.check_in && row.check_out) {
    const nights = Math.round(
      (Date.parse(`${row.check_out}T00:00:00Z`) - Date.parse(`${row.check_in}T00:00:00Z`)) / 86_400_000,
    )
    parts.push(`${row.check_in} → ${row.check_out} (${nights} night${nights === 1 ? '' : 's'})`)
  } else if (row.check_in) {
    parts.push(`from ${row.check_in}, open-ended`)
  } else {
    parts.push('no dates yet')
  }

  if (row.address) parts.push(row.address)
  else if (row.city) parts.push(row.city)
  if (row.notes) parts.push(`— ${row.notes}`)

  return parts.join(' · ')
}

export const stayTools: AnyTool[] = [listStays, addStay, updateStay, removeStay]
