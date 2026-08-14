/**
 * Adding a flight. Spec 9.8.
 *
 * Manual entry is **the baseline, not the fallback**. A flight number and a
 * date are enough; the lookup fills in the rest when it can and is allowed to
 * fail silently when it cannot. Every route — typed, pasted, or looked up —
 * converges on the same confirm-before-save step, so nothing is written from a
 * guess the user has not seen.
 */
'use client'

import { useState } from 'react'
import { ClipboardPaste, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { PersonBadge } from '@/components/PersonBadge'
import { userMessage } from '@/lib/errors'
import { isValidDateOnly, tripLocalToUtc } from '@/lib/dates'
import { useCouple } from '@/providers/CoupleProvider'
import { normaliseFlightNumber } from '../logic'
import { parseConfirmation } from '../parse'
import { useAddFlight, useLookupFlight } from '../hooks'
import type { LookupResult } from '../api'
import { AirportPicker } from './AirportPicker'
import type { AirportRow } from '../types'

export function AddFlightForm({
  tripId,
  onClose,
}: {
  tripId?: string | null
  onClose: () => void
}) {
  const { self, selfRef, partnerRef } = useCouple()
  const add = useAddFlight()
  const lookup = useLookupFlight()

  const [flightNumber, setFlightNumber] = useState('')
  const [date, setDate] = useState('')
  const [travelerId, setTravelerId] = useState(self?.id ?? '')
  const [hasBags, setHasBags] = useState(true)
  const [pasting, setPasting] = useState(false)
  const [pasted, setPasted] = useState('')
  const [resolved, setResolved] = useState<LookupResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Times the user types when nothing resolved them.
  const [departure, setDeparture] = useState('')
  const [arrival, setArrival] = useState('')

  // The route. Typed by hand unless a lookup filled it — which needs an API
  // key, and the app is built to work without one. A flight number with no
  // endpoints is not a flight: it cannot draw, cannot be timed against a
  // destination clock, and reads as `??? → ???`.
  const [originIata, setOriginIata] = useState('')
  const [destIata, setDestIata] = useState('')
  const [originAirport, setOriginAirport] = useState<AirportRow | null>(null)
  const [destAirport, setDestAirport] = useState<AirportRow | null>(null)

  const people = [selfRef, partnerRef].filter(Boolean)

  const runLookup = async () => {
    setError(null)
    const number = normaliseFlightNumber(flightNumber)
    if (!number || !isValidDateOnly(date)) {
      setError('A flight number and a date, and the rest is optional.')
      return
    }
    setFlightNumber(number)
    const result = await lookup.mutateAsync({ flightNumber: number, date })
    setResolved(result)
    // Fill the route from the lookup, but leave it editable: the provider is
    // right more often than a person, and wrong often enough to matter.
    if (result?.originIata) setOriginIata(result.originIata)
    if (result?.destIata) setDestIata(result.destIata)
  }

  const onPaste = () => {
    const [first] = parseConfirmation(pasted)
    if (!first) {
      setError('No flight number in that text — type it in instead.')
      return
    }
    setError(null)
    setFlightNumber(first.flightNumber)
    if (first.date) setDate(first.date)
    setPasting(false)
  }

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

    await add.mutateAsync({
      flight_number: number,
      flight_date: date,
      traveler_id: travelerId,
      trip_id: tripId ?? null,
      has_checked_bags: hasBags,
      callsign: resolved?.callsign ?? null,
      airline_iata: resolved?.airlineIata ?? null,
      airline_name: resolved?.airlineName ?? null,
      registration: resolved?.registration ?? null,
      aircraft_type: resolved?.aircraftType ?? null,
      // What the user chose wins over what the provider said: they are
      // holding the booking email.
      origin_iata: originIata || resolved?.originIata || null,
      origin_name: originAirport?.name ?? resolved?.originName ?? null,
      origin_tz: originAirport?.timezone ?? resolved?.originTz ?? null,
      origin_lat: originAirport ? Number(originAirport.lat) : null,
      origin_lng: originAirport ? Number(originAirport.lng) : null,
      dest_iata: destIata || resolved?.destIata || null,
      dest_name: destAirport?.name ?? resolved?.destName ?? null,
      dest_tz: destAirport?.timezone ?? resolved?.destTz ?? null,
      dest_lat: destAirport ? Number(destAirport.lat) : null,
      dest_lng: destAirport ? Number(destAirport.lng) : null,
      // A departure time is in the departure airport's zone, not the viewer's.
      // "11:25 from Dubai" means 11:25 in Dubai wherever you are reading it.
      scheduled_departure:
        resolved?.scheduledDeparture ?? toInstant(departure, originAirport?.timezone ?? null),
      scheduled_arrival:
        resolved?.scheduledArrival ?? toInstant(arrival, destAirport?.timezone ?? null),
      estimated_departure: resolved?.estimatedDeparture ?? null,
      estimated_arrival: resolved?.estimatedArrival ?? null,
      gate: resolved?.gate ?? null,
      terminal: resolved?.terminal ?? null,
      // Unresolved and untimed is a real state, and the phase says so rather
      // than pretending the flight is scheduled for a time nobody supplied.
      phase: resolved?.resolved ? 'scheduled' : departure ? 'scheduled' : 'unknown',
    })

    onClose()
  }

  return (
    <div className="space-y-4">
      {pasting ? (
        <div className="space-y-3">
          <Field label="Paste the confirmation" htmlFor="paste-confirmation">
            <Textarea
              id="paste-confirmation"
              rows={6}
              autoFocus
              value={pasted}
              placeholder="Paste the email or message and we'll pull the flight out of it."
              onChange={(e) => setPasted(e.target.value)}
            />
          </Field>
          <div className="flex gap-2">
            <Button onClick={onPaste}>Read it</Button>
            <Button variant="ghost" onClick={() => setPasting(false)}>
              Type it instead
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Flight number" hint="AC 42, ac0042 — all the same" htmlFor="flight-number">
              <Input
                id="flight-number"
                autoFocus
                value={flightNumber}
                placeholder="AC42"
                className="uppercase"
                onChange={(e) => setFlightNumber(e.target.value)}
              />
            </Field>
            <Field label="Date of departure" htmlFor="flight-date">
              <Input
                id="flight-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
          </div>

          {/* The route. Always shown and always editable, whether or not a
              lookup filled it — without these the flight has no endpoints,
              which is what produced `??? → ???`. */}
          <div className="grid gap-3 sm:grid-cols-2">
            <AirportPicker
              id="flight-origin"
              label="From"
              value={originIata}
              hint="Where it takes off"
              onChange={(iata, airport) => {
                setOriginIata(iata)
                setOriginAirport(airport)
              }}
            />
            <AirportPicker
              id="flight-dest"
              label="To"
              value={destIata}
              hint="Where it lands"
              onChange={(iata, airport) => {
                setDestIata(iata)
                setDestAirport(airport)
              }}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={lookup.isPending} onClick={() => void runLookup()}>
              <Search aria-hidden="true" />
              {lookup.isPending ? 'Looking up…' : 'Look it up'}
            </Button>
            <Button variant="ghost" onClick={() => setPasting(true)}>
              <ClipboardPaste aria-hidden="true" />
              Paste a confirmation
            </Button>
          </div>

          {resolved && (
            <div className="rounded-md border border-border p-3 text-sm">
              {resolved.resolved ? (
                <>
                  <p className="font-medium">
                    {resolved.airlineName ?? resolved.airlineIata} · {resolved.originIata} →{' '}
                    {resolved.destIata}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Times and timezones filled in. Check them before saving.
                  </p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {resolved.notice ?? 'Could not resolve that one.'} Save it anyway and fill in the
                  times yourself — tracking still works from what you enter.
                </p>
              )}
            </div>
          )}

          {!resolved?.resolved && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={originAirport ? `Departs (${originAirport.city} time)` : 'Departs (your time)'} htmlFor="flight-dep">
                <Input
                  id="flight-dep"
                  type="datetime-local"
                  value={departure}
                  onChange={(e) => setDeparture(e.target.value)}
                />
              </Field>
              <Field label={destAirport ? `Arrives (${destAirport.city} time)` : 'Arrives (your time)'} htmlFor="flight-arr">
                <Input
                  id="flight-arr"
                  type="datetime-local"
                  value={arrival}
                  onChange={(e) => setArrival(e.target.value)}
                />
              </Field>
            </div>
          )}

          <Field label="Who is flying?" htmlFor="flight-traveler">
            <div className="flex flex-wrap items-center gap-3">
              <Select
                id="flight-traveler"
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

          {(error || add.error) && (
            <p className="text-sm text-destructive" role="alert">
              {error ?? userMessage(add.error)}
            </p>
          )}

          <div className="flex gap-2">
            <Button disabled={add.isPending} onClick={() => void save()}>
              {add.isPending ? 'Saving…' : 'Add flight'}
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

/** A `datetime-local` value is wall-clock; the column wants an instant. */
/**
 * A typed local time, in the airport's zone, as an instant.
 *
 * Without a zone this falls back to the browser's, which is the old behaviour
 * and wrong the moment somebody enters a flight while sitting somewhere else —
 * which, for this app's users, is most of the time.
 */
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
