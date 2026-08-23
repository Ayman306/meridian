/**
 * The trip, seen whole, before anybody starts planning.
 *
 * Everything a trip is made of already existed in this app — flights on one
 * tab, days on another, saved places on a third, the map on a fourth. Each was
 * fine for editing and none of them answered the question somebody actually
 * opens a trip with: *what does this look like?* Answering that meant reading
 * four screens and holding them in your head.
 *
 * ## Why it is not a list of days
 *
 * The obvious build is one card per day down the page. It is also the wrong
 * one: a fortnight becomes a page nobody scrolls to the end of, and the shape
 * of the trip is the first casualty. So the layout is fixed height —
 * map, a strip of days, one day's detail — and tapping through the trip moves
 * nothing. Three regions, no growth.
 *
 * ## Why it asks for almost nothing
 *
 * Every piece here is derived rather than entered:
 *
 *   - the days, from the trip's own dates when no rows exist yet;
 *   - which day is travel, from the flights;
 *   - where the trip is on a given day, from the chosen destinations;
 *   - which day to open on, from the calendar;
 *   - what to offer adding, from saved places already near the route;
 *   - the cycle marks, from predictions that were already being made.
 *
 * The only input is a tap. Two, if you count adding a place — and that one
 * lands on the day already in view, dated, placed and attributed, because all
 * of that was known before the tap.
 */
'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ErrorState, PageLoading } from '@/components/common/states'
import { EmptyState } from '@/components/common/states'
import { useCouple } from '@/providers/CoupleProvider'
import { todayIn } from '@/lib/dates'
import type { DateOnly } from '@/lib/dates'
import { MapCanvas, usePinPeople, fallbackCenter } from '@/modules/map'
import type { MapPin } from '@/modules/map'
import { useItems } from '@/modules/itinerary'
import { useFlights } from '@/modules/flights'
import { useDestinations } from '@/modules/destinations'
import { usePushToItinerary, useWishlist } from '@/modules/wishlist'
import { useStays, useStaysRealtime } from '@/modules/stays'
import { describeDayMark, showsCycle, useCycleWindow } from '@/modules/health'
import { useTrip } from '../hooks'
import { isLongStay } from '../logic'
import {
  buildJourney,
  dayCentre,
  describeTripJourney,
  focusDay,
  journeyCentre,
  nearbyWishlist,
} from '../journey'
import type { TripJourney } from '../journey'
import { DayStrip } from '../components/DayStrip'
import { DayPanel } from '../components/DayPanel'

/** What each kind of stop looks like on the map. */
const STOP_COLORS: Record<TripJourney['route'][number]['kind'], string> = {
  airport: 'hsl(210 90% 62%)',
  destination: 'hsl(38 92% 50%)',
  stay: 'hsl(280 60% 62%)',
  item: 'hsl(150 60% 45%)',
}

export function TripJourneyPage() {
  const { id } = useParams<{ id: string }>()
  const { tzSelf, self } = useCouple()
  const today = todayIn(tzSelf)

  const trip = useTrip(id)
  const items = useItems(id)
  const flights = useFlights()
  const destinations = useDestinations(id)
  const wishlist = useWishlist()
  const stays = useStays(id)
  useStaysRealtime(id)
  const push = usePushToItinerary(id)

  const { colorFor, nameFor } = usePinPeople()
  const [chosen, setChosen] = useState<DateOnly | null>(null)
  const [adding, setAdding] = useState<string | null>(null)

  const journey = useMemo(
    () =>
      buildJourney({
        startDate: trip.data?.start_date ?? null,
        endDate: trip.data?.end_date ?? null,
        days: trip.data?.days ?? [],
        // The flights query is couple-wide; a trip only owns the ones pointed
        // at it. Both partners' legs belong here — a journey with one person's
        // flights missing is not this couple's journey.
        flights: (flights.data ?? []).filter((f) => f.trip_id === id),
        items: items.data ?? [],
        destinations: destinations.data ?? [],
        stays: stays.data ?? [],
      }),
    [trip.data, flights.data, items.data, destinations.data, stays.data, id],
  )

  // The chosen day only overrides the derived one; it is not the source of
  // truth. That way a trip whose dates change does not leave the panel showing
  // a day that no longer exists.
  const derived = focusDay(journey, today)
  const selected = journey.days.some((d) => d.date === chosen) ? chosen : derived
  const day = journey.days.find((d) => d.date === selected) ?? null

  const cycleMarks = useCycleWindow(
    journey.days[0]?.date ?? null,
    journey.days[journey.days.length - 1]?.date ?? null,
  )
  // Owner-only by construction: `useCycleWindow` reads nobody else's logs, and
  // the section is hidden entirely for anyone not tracking a cycle.
  const tracksCycle = showsCycle(self)
  const cycleDays = useMemo(() => {
    const labelled = new Map<DateOnly, string>()
    if (!tracksCycle) return labelled
    for (const [date, mark] of cycleMarks) {
      // Only period days earn a mark on the strip. The fertile window is a
      // wash across a third of every cycle, and a dot on a third of the trip
      // is decoration rather than information — it stays in the panel.
      if (!mark.period && !mark.predictedPeriod) continue
      labelled.set(date, mark.period ? 'period logged' : 'period expected')
    }
    return labelled
  }, [cycleMarks, tracksCycle])

  const pins = useMemo<MapPin[]>(
    () =>
      journey.route.map((stop, i) => ({
        id: `stop-${i}`,
        layer: 'itinerary' as const,
        title: stop.label,
        lat: stop.lat,
        lng: stop.lng,
        date: null,
        time: null,
        categoryId: null,
        personId: null,
        state: null,
        placeName: null,
        address: null,
        tripId: id,
        tripTitle: null,
        color: STOP_COLORS[stop.kind],
      })),
    [journey.route, id],
  )

  const plannedTitles = useMemo(
    () => (items.data ?? []).map((i) => i.title),
    [items.data],
  )
  // Centred on the day, not the trip. "Near where you are sleeping tonight" is
  // the question somebody actually has; "within 60 km of the trip" is a weak
  // filter on a city break and a useless one across two cities.
  const nearby = useMemo(() => {
    if (!day) return []
    return nearbyWishlist(wishlist.data ?? [], dayCentre(day, journey), plannedTitles)
      // Three is what fits on one line on a phone, and a longer list is a
      // decision rather than a suggestion.
      .slice(0, 3)
      .map(({ item, km }) => ({ id: item.id, title: item.title, km }))
  }, [wishlist.data, day, journey, plannedTitles])

  if (trip.isLoading) return <PageLoading />
  if (trip.error) return <ErrorState error={trip.error} onRetry={() => void trip.refetch()} />
  if (!trip.data) return null

  if (journey.days.length === 0) {
    return (
      <EmptyState
        title="No dates yet"
        description="A journey needs somewhere to start. Tap the dates above, and everything else — flights, days, saved places — lays itself out here."
      />
    )
  }

  const restful = isLongStay(trip.data)

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{describeTripJourney(journey)}</p>

      {pins.length > 0 ? (
        <MapCanvas
          pins={pins}
          route={pins}
          center={fallbackCenter(journeyCentre(journey))}
          colorFor={colorFor}
          nameFor={nameFor}
          className="h-[38vh] max-h-80 min-h-52 w-full rounded-lg border border-border"
        />
      ) : (
        <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          Nothing on the map yet. Choose a destination on{' '}
          <Link href={`/trips/${id}/where`} className="underline underline-offset-4">
            Where
          </Link>{' '}
          and the route draws itself.
        </div>
      )}

      <DayStrip
        days={journey.days}
        selected={selected}
        today={today}
        onSelect={setChosen}
        cycleDays={cycleDays}
      />

      {day && (
        <DayPanel
          day={day}
          restful={restful}
          cycleNote={tracksCycle ? cycleNote(describeDayMark(cycleMarks.get(day.date))) : null}
          nearby={nearby}
          addingId={adding}
          onAddNearby={(placeId) => {
            setAdding(placeId)
            push.mutate(
              { itemIds: [placeId], date: day.date },
              { onSettled: () => setAdding(null) },
            )
          }}
        />
      )}

      <p className="text-xs text-muted-foreground">
        Everything here is drawn from the trip&rsquo;s own flights, days and saved places.{' '}
        <Link href={`/trips/${id}/plan`} className="underline underline-offset-4">
          Plan
        </Link>{' '}
        is where it gets edited.
      </p>
    </div>
  )
}

/** One short line, or nothing. A day with no marks says nothing rather than "no". */
function cycleNote(described: string[]): string | null {
  if (described.length === 0) return null
  const sentence = described.join(', ')
  return sentence.charAt(0).toUpperCase() + sentence.slice(1)
}
