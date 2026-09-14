/**
 * Correcting a flight that is already saved. Spec 9.8.
 *
 * The counterpart to `AddFlightForm`, and it has one job that form does not:
 * making an edit *stick*. `refreshFlight` writes the provider's answer back
 * over the times, the gate and the terminal on every poll, so a corrected
 * departure saved as a plain column would revert the next time the flight
 * refreshed. Anything on the override allowlist is therefore written twice —
 * once as the column, so the screen is right immediately, and once into
 * `manual_override`, so the poll cannot undo it.
 *
 * That is a decision the user should be able to take back, so an overridden
 * flight offers a way to hand control back to the provider.
 */
'use client'

import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/input'
import { PersonBadge } from '@/components/PersonBadge'
import { userMessage } from '@/lib/errors'
import { formatInZone, isValidDateOnly, tripLocalToUtc } from '@/lib/dates'
import { useCouple } from '@/providers/CoupleProvider'
import { formatTripDates, useTrips } from '@/modules/trips'
import {
  flightEditPatch,
  normaliseFlightNumber,
  routeEndpoint,
  suggestTripForFlight,
} from '../logic'
import { useSetManualOverride, useUpdateFlight } from '../hooks'
import { AirportPicker } from './AirportPicker'
import type { AirportRow, FlightRow } from '../types'

export function EditFlightForm({
  flight,
  onClose,
}: {
  flight: FlightRow
  onClose: () => void
}) {
  const { selfRef, partnerRef } = useCouple()
  const update = useUpdateFlight()
  const override = useSetManualOverride()
  const trips = useTrips()

  const [flightNumber, setFlightNumber] = useState(flight.flight_number)
  const [date, setDate] = useState(flight.flight_date ?? '')
  const [travelerId, setTravelerId] = useState(flight.traveler_id ?? '')
  const [hasBags, setHasBags] = useState(flight.has_checked_bags ?? true)
  const [error, setError] = useState<string | null>(null)

  const [originIata, setOriginIata] = useState(flight.origin_iata ?? '')
  const [destIata, setDestIata] = useState(flight.dest_iata ?? '')
  const [originAirport, setOriginAirport] = useState<AirportRow | null>(null)
  const [destAirport, setDestAirport] = useState<AirportRow | null>(null)

  // Resolved the same way the save resolves it, so the zone named on the field
  // label is the zone the typed time is actually read in. Retyping the code of
  // an airport we have no row for drops the old zone rather than keeping it —
  // see `routeEndpoint`.
  const origin = routeEndpoint(originIata, originAirport, {
    iata: flight.origin_iata,
    name: flight.origin_name,
    tz: flight.origin_tz,
    lat: flight.origin_lat === null ? null : Number(flight.origin_lat),
    lng: flight.origin_lng === null ? null : Number(flight.origin_lng),
  })
  const dest = routeEndpoint(destIata, destAirport, {
    iata: flight.dest_iata,
    name: flight.dest_name,
    tz: flight.dest_tz,
    lat: flight.dest_lat === null ? null : Number(flight.dest_lat),
    lng: flight.dest_lng === null ? null : Number(flight.dest_lng),
  })
  const originTz = origin.tz
  const destTz = dest.tz

  // Times are shown in the airport's zone, not the viewer's: "11:25 from
  // Dubai" is 11:25 in Dubai wherever you happen to be reading it.
  const [departure, setDeparture] = useState(toLocalInput(flight.scheduled_departure, originTz))
  const [arrival, setArrival] = useState(toLocalInput(flight.scheduled_arrival, destTz))

  const [tripId, setTripId] = useState(flight.trip_id ?? '')
  const [gate, setGate] = useState(flight.gate ?? '')
  const [terminal, setTerminal] = useState(flight.terminal ?? '')
  const [belt, setBelt] = useState(flight.baggage_belt ?? '')

  const people = [selfRef, partnerRef].filter(Boolean)
  const pending = update.isPending || override.isPending

  // Offered, never applied. A loose flight whose date lands inside a trip is
  // almost always that trip's, but attaching it is the user's call.
  const suggestion =
    tripId === '' ? suggestTripForFlight(date || flight.flight_date, trips.data ?? []) : null
  // Guarded the same way `applyOverride` guards it: the column is jsonb and
  // could hold anything, and `Object.keys` of a string is a list of indices.
  const hasOverride =
    typeof flight.manual_override === 'object' &&
    flight.manual_override !== null &&
    !Array.isArray(flight.manual_override) &&
    Object.keys(flight.manual_override).length > 0

  const save = async () => {
    setError(null)
    const number = normaliseFlightNumber(flightNumber)
    if (!number || !isValidDateOnly(date)) {
      setError('A flight number and a date, and the rest is optional.')
      return
    }
    if (!travelerId) {
      setError('Whose flight is it?')
      return
    }

    const patch = flightEditPatch(flight as unknown as Record<string, unknown>, {
      flight_number: number,
      flight_date: date,
      traveler_id: travelerId,
      has_checked_bags: hasBags,
      trip_id: tripId || null,
      origin_iata: origin.iata,
      origin_name: origin.name,
      origin_tz: origin.tz,
      origin_lat: origin.lat,
      origin_lng: origin.lng,
      dest_iata: dest.iata,
      dest_name: dest.name,
      dest_tz: dest.tz,
      dest_lat: dest.lat,
      dest_lng: dest.lng,
      scheduled_departure: toInstant(departure, originTz),
      scheduled_arrival: toInstant(arrival, destTz),
      gate: gate.trim() || null,
      terminal: terminal.trim() || null,
      baggage_belt: belt.trim() || null,
    })

    // Closing an untouched form must not stamp the flight as manually held.
    if (!patch.changed) {
      onClose()
      return
    }

    await update.mutateAsync({ id: flight.id, patch: patch.columns as never })
    if (Object.keys(patch.override).length > 0) {
      await override.mutateAsync({ id: flight.id, override: patch.override })
    }
    onClose()
  }

  const handBack = async () => {
    setError(null)
    await update.mutateAsync({ id: flight.id, patch: { manual_override: null } as never })
    onClose()
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Flight number" hint="AC 42, ac0042 — all the same" htmlFor="edit-flight-number">
          <Input
            id="edit-flight-number"
            autoFocus
            value={flightNumber}
            className="uppercase"
            onChange={(e) => setFlightNumber(e.target.value)}
          />
        </Field>
        <Field label="Date of departure" htmlFor="edit-flight-date">
          <Input
            id="edit-flight-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <AirportPicker
          id="edit-flight-origin"
          label="From"
          value={originIata}
          hint="Where it takes off"
          onChange={(iata, airport) => {
            setOriginIata(iata)
            setOriginAirport(airport)
          }}
        />
        <AirportPicker
          id="edit-flight-dest"
          label="To"
          value={destIata}
          hint="Where it lands"
          onChange={(iata, airport) => {
            setDestIata(iata)
            setDestAirport(airport)
          }}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={originTz ? `Departs (${zoneLabel(originTz)} time)` : 'Departs (your time)'}
          htmlFor="edit-flight-dep"
        >
          <Input
            id="edit-flight-dep"
            type="datetime-local"
            value={departure}
            onChange={(e) => setDeparture(e.target.value)}
          />
        </Field>
        <Field
          label={destTz ? `Arrives (${zoneLabel(destTz)} time)` : 'Arrives (your time)'}
          htmlFor="edit-flight-arr"
        >
          <Input
            id="edit-flight-arr"
            type="datetime-local"
            value={arrival}
            onChange={(e) => setArrival(e.target.value)}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Terminal" htmlFor="edit-flight-terminal">
          <Input
            id="edit-flight-terminal"
            value={terminal}
            placeholder="3"
            onChange={(e) => setTerminal(e.target.value)}
          />
        </Field>
        <Field label="Gate" htmlFor="edit-flight-gate">
          <Input
            id="edit-flight-gate"
            value={gate}
            placeholder="B7"
            onChange={(e) => setGate(e.target.value)}
          />
        </Field>
        <Field label="Baggage belt" htmlFor="edit-flight-belt">
          <Input
            id="edit-flight-belt"
            value={belt}
            placeholder="4"
            onChange={(e) => setBelt(e.target.value)}
          />
        </Field>
      </div>

      {/* Which trip this belongs to. A flight added from the Flights tab has
          no trip, and without this it could never be given one — the trip view
          filters on `trip_id` and nothing else could set it. */}
      <Field
        label="Part of a trip"
        hint="Leave it loose if it is not part of a planned trip"
        htmlFor="edit-flight-trip"
      >
        <Select
          id="edit-flight-trip"
          value={tripId}
          onChange={(e) => setTripId(e.target.value)}
        >
          <option value="">Not on a trip</option>
          {(trips.data ?? []).map((trip) => (
            <option key={trip.id} value={trip.id}>
              {trip.title} · {formatTripDates(trip)}
            </option>
          ))}
        </Select>
      </Field>

      {suggestion && (
        <p className="-mt-2 text-xs text-muted-foreground">
          This date falls inside{' '}
          <button
            type="button"
            className="underline underline-offset-2 hover:text-foreground"
            onClick={() => setTripId(suggestion.id)}
          >
            {suggestion.title}
          </button>
          . Attach it?
        </p>
      )}

      <Field label="Who is flying?" htmlFor="edit-flight-traveler">
        <div className="flex flex-wrap items-center gap-3">
          <Select
            id="edit-flight-traveler"
            className="w-auto"
            value={travelerId}
            onChange={(e) => setTravelerId(e.target.value)}
          >
            {people.map((person) => (
              <option key={person!.id} value={person!.id}>
                {person!.isSelf ? 'You' : person!.displayName}
              </option>
            ))}
          </Select>
          <PersonBadge person={people.find((p) => p!.id === travelerId) ?? null} size="sm" />
        </div>
      </Field>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 size-4"
          checked={hasBags}
          onChange={(e) => setHasBags(e.target.checked)}
        />
        <span>
          Checked bags
          <span className="block text-xs text-muted-foreground">
            Adds the baggage wait to the pickup estimate. Untick for hand luggage only.
          </span>
        </span>
      </label>

      <p className="text-xs text-muted-foreground">
        Times, gate, terminal and belt stay as you set them — live updates will not overwrite
        them again.
      </p>

      {(error || update.error || override.error) && (
        <p className="text-sm text-destructive" role="alert">
          {error ?? userMessage(update.error ?? override.error)}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button disabled={pending} onClick={() => void save()}>
          {pending ? 'Saving…' : 'Save changes'}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        {hasOverride && (
          <Button
            variant="ghost"
            className="ml-auto"
            disabled={pending}
            title="Drop your corrections and follow the airline's data again"
            onClick={() => void handBack()}
          >
            <RotateCcw aria-hidden="true" />
            Use live data again
          </Button>
        )}
      </div>
    </div>
  )
}

/** An instant, as the `datetime-local` value for a given zone. */
function toLocalInput(instant: string | null, zone: string | null): string {
  if (!instant) return ''
  if (!zone) {
    const parsed = new Date(instant)
    if (Number.isNaN(parsed.getTime())) return ''
    // `toISOString` is UTC; the input wants the browser's wall clock.
    const offset = parsed.getTimezoneOffset() * 60_000
    return new Date(parsed.getTime() - offset).toISOString().slice(0, 16)
  }
  return formatInZone(instant, zone, "yyyy-MM-dd'T'HH:mm")
}

/** A typed local time, in the airport's zone, as an instant. */
function toInstant(local: string, zone: string | null): string | null {
  if (!local) return null
  if (!zone) {
    const parsed = new Date(local)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
  }
  const [date, time] = local.split('T')
  if (!date || !time) return null
  return tripLocalToUtc(date, time.slice(0, 5), zone).toISOString()
}

/** "Asia/Dubai" reads better as "Dubai" on a field label. */
function zoneLabel(zone: string): string {
  return (zone.split('/').pop() ?? zone).replace(/_/g, ' ')
}
