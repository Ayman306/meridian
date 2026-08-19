/**
 * A whole trip as one ordered picture.
 *
 * The app already holds every piece of a trip — flights, days, planned items,
 * destinations, saved places — and until now each lived on its own tab. That
 * is fine for editing and useless for *seeing*: nobody plans by opening eight
 * screens and holding them in their head. This merges them into one timeline
 * and one route.
 *
 * Pure, and tested. Every visual decision on the journey screen reads from
 * here, so a mistake in this file is a mistake in the picture somebody plans
 * their trip from.
 *
 * Two ordering rules that are easy to get wrong:
 *
 *   - **Flights bracket a day, they do not sit inside it.** An arrival at 06:00
 *     comes before everything planned that day; a departure at 21:00 comes
 *     after. Sorting flights in with items by time would be right by accident
 *     and wrong whenever an item has no time at all.
 *   - **A day with nothing on it is not the same as a day nobody has reached
 *     yet.** `rest` means deliberately empty (non-negotiable #6). `open` means
 *     unplanned. The timeline keeps them distinct so the screen can too.
 */
import { addDaysTo, daysBetween, type DateOnly } from '@/lib/dates'
import { haversineKm, type LatLng } from '@/lib/utils'

/** One thing happening on a day. */
export type JourneyEntry =
  | { kind: 'arrive'; at: string | null; flightNumber: string; airport: string | null; id: string }
  | { kind: 'depart'; at: string | null; flightNumber: string; airport: string | null; id: string }
  | {
      kind: 'item'
      id: string
      title: string
      time: string | null
      placeName: string | null
      state: string | null
      lat: number | null
      lng: number | null
    }

export interface JourneyDay {
  date: DateOnly
  /** 1 for the first day of the trip. */
  index: number
  dayType: string
  title: string | null
  note: string | null
  /** Which destination the trip is at on this day, when that is known. */
  place: string | null
  entries: JourneyEntry[]
  /** Nothing planned, and not deliberately so. */
  isOpen: boolean
  /** Blank on purpose — the point of a long stay, never a gap to fill. */
  isRest: boolean
  /** Somebody is in the air. */
  isTravel: boolean
}

export interface TripJourney {
  days: JourneyDay[]
  /** The route the trip traces, in order, for drawing. */
  route: { lat: number; lng: number; label: string; kind: 'airport' | 'destination' | 'item' }[]
  totalKm: number
  /** How many days have something on them. */
  plannedDays: number
  openDays: number
  restDays: number
}

export interface JourneyInput {
  startDate: DateOnly | null
  endDate: DateOnly | null
  days: { date: DateOnly; day_type: string | null; title: string | null; note: string | null }[]
  flights: {
    id: string
    flight_number: string
    flight_date: DateOnly | null
    origin_iata: string | null
    dest_iata: string | null
    origin_lat: number | null
    origin_lng: number | null
    dest_lat: number | null
    dest_lng: number | null
    scheduled_departure: string | null
    scheduled_arrival: string | null
  }[]
  items: {
    id: string
    title: string
    scheduled_date: DateOnly | null
    start_time: string | null
    place_name: string | null
    state: string | null
    lat: number | null
    lng: number | null
  }[]
  destinations: {
    city: string
    arrive_on: DateOnly | null
    depart_on: DateOnly | null
    lat: number | null
    lng: number | null
    state: string | null
  }[]
}

/**
 * Build the timeline.
 *
 * Days come from `trip_days` when they exist, and are derived from the trip's
 * own dates when they do not — a trip whose days have not been synced yet
 * should still draw, rather than showing an empty screen that looks broken.
 */
export function buildJourney(input: JourneyInput): TripJourney {
  const dates = timelineDates(input)

  const days: JourneyDay[] = dates.map((date, i) => {
    const row = input.days.find((d) => d.date === date)
    const dayType = row?.day_type ?? 'open'

    const arrivals = input.flights
      .filter((f) => f.flight_date === date && f.dest_iata)
      .map(
        (f): JourneyEntry => ({
          kind: 'arrive',
          at: f.scheduled_arrival,
          flightNumber: f.flight_number,
          airport: f.dest_iata,
          id: `${f.id}:in`,
        }),
      )

    const departures = input.flights
      .filter((f) => f.flight_date === date && f.origin_iata)
      .map(
        (f): JourneyEntry => ({
          kind: 'depart',
          at: f.scheduled_departure,
          flightNumber: f.flight_number,
          airport: f.origin_iata,
          id: `${f.id}:out`,
        }),
      )

    const items = input.items
      .filter((it) => it.scheduled_date === date)
      .map(
        (it): JourneyEntry => ({
          kind: 'item',
          id: it.id,
          title: it.title,
          time: it.start_time,
          placeName: it.place_name,
          state: it.state,
          lat: it.lat,
          lng: it.lng,
        }),
      )
      // Timed things first, in order; untimed after, since "sometime today" is
      // not a claim about being early.
      .sort((a, b) => {
        const at = a.kind === 'item' ? a.time : null
        const bt = b.kind === 'item' ? b.time : null
        if (at && bt) return at.localeCompare(bt)
        if (at) return -1
        if (bt) return 1
        return 0
      })

    // Arrivals bracket the day at the front, departures at the back. See the
    // note at the top for why this is not a time sort.
    const entries = [...arrivals, ...items, ...departures]

    const isTravel = arrivals.length > 0 || departures.length > 0
    const isRest = dayType === 'rest'

    return {
      date,
      index: i + 1,
      dayType,
      title: row?.title ?? null,
      note: row?.note ?? null,
      place: placeOn(date, input.destinations),
      entries,
      isRest,
      isOpen: !isRest && !isTravel && items.length === 0,
      isTravel,
    }
  })

  const route = buildRoute(input, dates)

  return {
    days,
    route,
    totalKm: routeLength(route),
    plannedDays: days.filter((d) => d.entries.some((e) => e.kind === 'item')).length,
    openDays: days.filter((d) => d.isOpen).length,
    restDays: days.filter((d) => d.isRest).length,
  }
}

/** Every date the timeline covers, whether or not a row exists for it. */
function timelineDates(input: JourneyInput): DateOnly[] {
  if (input.days.length > 0) {
    return [...input.days].map((d) => d.date).sort((a, b) => a.localeCompare(b))
  }
  if (!input.startDate) return []
  const end = input.endDate ?? input.startDate
  const span = Math.max(0, daysBetween(input.startDate, end))
  return Array.from({ length: span + 1 }, (_, i) => addDaysTo(input.startDate!, i))
}

/** Which destination the trip is at on a given day. */
function placeOn(
  date: DateOnly,
  destinations: JourneyInput['destinations'],
): string | null {
  const covering = destinations.find(
    (d) =>
      d.state !== 'rejected' &&
      d.arrive_on !== null &&
      date >= d.arrive_on &&
      date <= (d.depart_on ?? d.arrive_on),
  )
  return covering?.city ?? null
}

/**
 * The line the trip traces.
 *
 * Airports first and last where flights are known, destinations in date order
 * between them, and planned places threaded in. Anything without coordinates is
 * skipped rather than approximated — a route drawn through a guess is worse
 * than a route with a gap.
 */
function buildRoute(input: JourneyInput, dates: DateOnly[]): TripJourney['route'] {
  const route: TripJourney['route'] = []
  const push = (
    lat: number | null,
    lng: number | null,
    label: string,
    kind: TripJourney['route'][number]['kind'],
  ) => {
    if (lat === null || lng === null) return
    const last = route[route.length - 1]
    // Two pins on the same spot add nothing to a line.
    if (last && last.lat === lat && last.lng === lng) return
    route.push({ lat, lng, label, kind })
  }

  const flights = [...input.flights]
    .filter((f) => f.flight_date)
    .sort((a, b) => a.flight_date!.localeCompare(b.flight_date!))

  const first = flights[0]
  if (first) push(first.origin_lat, first.origin_lng, first.origin_iata ?? 'Departure', 'airport')

  for (const date of dates) {
    for (const flight of flights.filter((f) => f.flight_date === date)) {
      push(flight.dest_lat, flight.dest_lng, flight.dest_iata ?? 'Airport', 'airport')
    }

    const destination = input.destinations.find((d) => d.arrive_on === date && d.state !== 'rejected')
    if (destination) push(destination.lat, destination.lng, destination.city, 'destination')

    for (const item of input.items.filter((it) => it.scheduled_date === date)) {
      push(item.lat, item.lng, item.place_name ?? item.title, 'item')
    }
  }

  return route
}

function routeLength(route: TripJourney['route']): number {
  let total = 0
  for (let i = 0; i < route.length - 1; i++) {
    total += haversineKm(route[i] as LatLng, route[i + 1] as LatLng)
  }
  return total
}

/**
 * Saved places worth offering for this trip.
 *
 * The wishlist already holds things the couple wanted to do. Anything near
 * where they are going is a plan they have half-made, and offering it is the
 * largest reduction in typing available anywhere in the app — the data is
 * already theirs.
 *
 * Anything already on the itinerary is excluded by title, which is the same
 * comparison `push_wishlist_to_itinerary` makes when it refuses to add a
 * duplicate. Matching on a different rule here would offer somebody a place the
 * database would then decline to add.
 */
export function nearbyWishlist<
  T extends { id: string; title: string; lat: number | null; lng: number | null },
>(
  wishlist: readonly T[],
  centre: LatLng | null,
  plannedTitles: readonly string[],
  radiusKm = 60,
): { item: T; km: number }[] {
  if (!centre) return []
  const planned = new Set(plannedTitles.map((t) => t.toLowerCase()))

  return wishlist
    .filter((w) => w.lat !== null && w.lng !== null && !planned.has(w.title.toLowerCase()))
    .map((item) => ({ item, km: haversineKm(centre, { lat: item.lat!, lng: item.lng! }) }))
    .filter(({ km }) => km <= radiusKm)
    .sort((a, b) => a.km - b.km)
}

/** Where the trip is centred, for the nearby search and the initial map view. */
export function journeyCentre(journey: TripJourney): LatLng | null {
  const destination = journey.route.find((p) => p.kind === 'destination')
  if (destination) return { lat: destination.lat, lng: destination.lng }
  // No destination chosen yet — the airport they land at is the next best guess
  // at where the trip actually happens.
  const airport = journey.route.filter((p) => p.kind === 'airport')[1] ?? journey.route[0]
  return airport ? { lat: airport.lat, lng: airport.lng } : null
}

/** A sentence for the top of the screen. */
export function describeTripJourney(journey: TripJourney): string {
  if (journey.days.length === 0) return 'No dates yet, so there is nothing to lay out.'

  const parts = [`${journey.days.length} day${journey.days.length === 1 ? '' : 's'}`]
  if (journey.plannedDays > 0) parts.push(`${journey.plannedDays} with something planned`)
  if (journey.restDays > 0) parts.push(`${journey.restDays} kept clear`)
  if (journey.openDays > 0) parts.push(`${journey.openDays} still open`)

  return parts.join(' · ')
}

/**
 * Which day the screen should open on.
 *
 * A trip view that opens on day one is only right on the day you create it.
 * During the trip the answer is today; before it, the day something actually
 * happens — the first flight — because that is the day a person is checking.
 * Falling back to day one is the last resort, not the default.
 *
 * Returning a date rather than an index keeps the caller from having to know
 * whether `days` is dense, which it is not when the trip has no rows yet.
 */
export function focusDay(journey: TripJourney, today: DateOnly): DateOnly | null {
  const days = journey.days
  if (days.length === 0) return null

  const current = days.find((d) => d.date === today)
  if (current) return current.date

  // Trip already over: the last day is the one worth looking back at.
  const last = days[days.length - 1]!
  if (today > last.date) return last.date

  return days.find((d) => d.isTravel)?.date ?? days[0]!.date
}
