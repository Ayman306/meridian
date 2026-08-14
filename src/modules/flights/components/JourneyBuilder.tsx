/**
 * Build a whole booking: out, back, and every leg in between.
 *
 * The old form added one flight at a time with no way to say that two of them
 * were the same trip. That fails the ordinary case — a return ticket with a
 * connection is four flights, one booking reference, and two directions — and
 * it is what made the app unable to warn about a tight layover even though the
 * arithmetic for it was already written and tested.
 *
 * One screen, and it adapts rather than branching:
 *
 * - **One-way or return.** Return reveals a second list and mirrors the route
 *   backwards as a starting point, because the way home is usually the way out
 *   reversed and retyping four airports is the kind of thing that makes people
 *   stop using an app.
 * - **Any number of legs.** One leg is a direct flight and needs no extra
 *   thought; adding a leg prefills its origin from the previous leg's
 *   destination, since that is what a connection *is*.
 * - **Nothing is required except a flight number and a date.** A trip booked
 *   but not yet detailed still saves. Everything else fills in later.
 */
'use client'

import { useState } from 'react'
import { ArrowRight, Plane, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field, Input } from '@/components/ui/input'
import { PersonBadge } from '@/components/PersonBadge'
import { ErrorState } from '@/components/common/states'
import { isValidDateOnly, tripLocalToUtc } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { useCouple } from '@/providers/CoupleProvider'
import { AirportPicker } from './AirportPicker'
import { normaliseFlightNumber } from '../logic'
import { parseConfirmation } from '../parse'
import { useAddJourney } from '../hooks'
import type { AirportRow } from '../types'

/** One row in the builder. Mirrors what a flight needs, nothing more. */
interface LegDraft {
  key: string
  flightNumber: string
  date: string
  originIata: string
  destIata: string
  originAirport: AirportRow | null
  destAirport: AirportRow | null
  departure: string
  arrival: string
}

const emptyLeg = (over: Partial<LegDraft> = {}): LegDraft => ({
  key: crypto.randomUUID(),
  flightNumber: '',
  date: '',
  originIata: '',
  destIata: '',
  originAirport: null,
  destAirport: null,
  departure: '',
  arrival: '',
  ...over,
})

export function JourneyBuilder({
  tripId,
  onClose,
}: {
  tripId?: string | null
  onClose: () => void
}) {
  const { self, selfRef, partnerRef } = useCouple()
  const save = useAddJourney()

  const [isReturn, setIsReturn] = useState(false)
  const [travelerId, setTravelerId] = useState(self?.id ?? '')
  const [bookingRef, setBookingRef] = useState('')
  const [hasBags, setHasBags] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pasted, setPasted] = useState('')

  const [out, setOut] = useState<LegDraft[]>([emptyLeg()])
  const [back, setBack] = useState<LegDraft[]>([emptyLeg()])

  const people = [selfRef, partnerRef].filter(Boolean)

  const update = (
    which: 'out' | 'back',
    key: string,
    patch: Partial<LegDraft>,
  ) => {
    const setter = which === 'out' ? setOut : setBack
    setter((legs) => legs.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  /** A new leg starts where the last one ended — that is what a connection is. */
  const addLeg = (which: 'out' | 'back') => {
    const legs = which === 'out' ? out : back
    const previous = legs[legs.length - 1]
    const setter = which === 'out' ? setOut : setBack
    setter([
      ...legs,
      emptyLeg({
        originIata: previous?.destIata ?? '',
        originAirport: previous?.destAirport ?? null,
        date: previous?.date ?? '',
      }),
    ])
  }

  const removeLeg = (which: 'out' | 'back', key: string) => {
    const setter = which === 'out' ? setOut : setBack
    setter((legs) => (legs.length === 1 ? legs : legs.filter((l) => l.key !== key)))
  }

  /**
   * Turning on "return" seeds the way home from the way out, reversed.
   * A starting point, not an assumption — every field stays editable.
   */
  const enableReturn = () => {
    setIsReturn(true)
    const first = out[0]
    const last = out[out.length - 1]
    if (first && last && last.destIata && first.originIata) {
      setBack([
        emptyLeg({
          originIata: last.destIata,
          originAirport: last.destAirport,
          destIata: first.originIata,
          destAirport: first.originAirport,
        }),
      ])
    }
  }

  /** Pull whatever a confirmation email will give us into the outbound legs. */
  const applyPaste = () => {
    const parsed = parseConfirmation(pasted)
    if (parsed.length === 0) {
      setError('No flight numbers in that text — fill the legs in by hand.')
      return
    }
    setError(null)
    setOut(
      parsed.map((p) =>
        emptyLeg({ flightNumber: p.flightNumber, date: p.date ?? '' }),
      ),
    )
    setPasted('')
  }

  const toLegInput = (leg: LegDraft, index: number) => ({
    legIndex: index + 1,
    flightNumber: normaliseFlightNumber(leg.flightNumber),
    flightDate: leg.date,
    originIata: leg.originIata || null,
    originName: leg.originAirport?.name ?? null,
    originTz: leg.originAirport?.timezone ?? null,
    originLat: leg.originAirport ? Number(leg.originAirport.lat) : null,
    originLng: leg.originAirport ? Number(leg.originAirport.lng) : null,
    destIata: leg.destIata || null,
    destName: leg.destAirport?.name ?? null,
    destTz: leg.destAirport?.timezone ?? null,
    destLat: leg.destAirport ? Number(leg.destAirport.lat) : null,
    destLng: leg.destAirport ? Number(leg.destAirport.lng) : null,
    // A time belongs to the airport it happens at, not to whoever is typing.
    scheduledDeparture: toInstant(leg.departure, leg.originAirport?.timezone ?? null),
    scheduledArrival: toInstant(leg.arrival, leg.destAirport?.timezone ?? null),
  })

  const submit = async () => {
    setError(null)
    if (!travelerId) {
      setError('Whose journey is it?')
      return
    }

    const valid = (legs: LegDraft[]) =>
      legs.filter((l) => normaliseFlightNumber(l.flightNumber) && isValidDateOnly(l.date))

    const outLegs = valid(out)
    if (outLegs.length === 0) {
      setError('Each leg needs a flight number and a date. The rest can wait.')
      return
    }
    const backLegs = isReturn ? valid(back) : []
    if (isReturn && backLegs.length === 0) {
      setError('The return needs a flight number and a date too, or switch it off.')
      return
    }

    try {
      await save.mutateAsync({
        tripId: tripId ?? null,
        travelerId,
        bookingRef: bookingRef.trim() || null,
        hasCheckedBags: hasBags,
        outbound: outLegs.map(toLegInput),
        return: backLegs.length > 0 ? backLegs.map(toLegInput) : undefined,
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not save.')
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        <Button
          variant={isReturn ? 'ghost' : 'default'}
          size="sm"
          onClick={() => setIsReturn(false)}
        >
          One way
        </Button>
        <Button variant={isReturn ? 'default' : 'ghost'} size="sm" onClick={enableReturn}>
          Return
        </Button>
      </div>

      <Field label="Paste the confirmation" htmlFor="journey-paste" hint="Optional. Pulls the flight numbers and dates out of a booking email.">
        <div className="flex gap-2">
          <Input
            id="journey-paste"
            placeholder="Paste it here"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
          />
          <Button variant="outline" disabled={!pasted.trim()} onClick={applyPaste}>
            Read it
          </Button>
        </div>
      </Field>

      <LegList
        title="Outbound"
        legs={out}
        onUpdate={(key, patch) => update('out', key, patch)}
        onAdd={() => addLeg('out')}
        onRemove={(key) => removeLeg('out', key)}
      />

      {isReturn && (
        <LegList
          title="Coming back"
          legs={back}
          onUpdate={(key, patch) => update('back', key, patch)}
          onAdd={() => addLeg('back')}
          onRemove={(key) => removeLeg('back', key)}
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Booking reference" htmlFor="journey-ref" hint="Optional. Ties the two directions together.">
          <Input
            id="journey-ref"
            placeholder="J7JUVF"
            value={bookingRef}
            onChange={(e) => setBookingRef(e.target.value.toUpperCase())}
          />
        </Field>

        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">Who is flying?</legend>
          <div className="flex gap-2">
            {people.map((person) => (
              <label
                key={person!.id}
                className={cn(
                  'flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm',
                  travelerId === person!.id ? 'border-accent bg-accent/10' : 'border-input',
                )}
              >
                <input
                  type="radio"
                  name="journey-traveler"
                  className="sr-only"
                  checked={travelerId === person!.id}
                  onChange={() => setTravelerId(person!.id)}
                />
                <PersonBadge person={person} size="xs" />
                {person!.isSelf ? 'Me' : person!.displayName}
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={hasBags}
          onChange={(e) => setHasBags(e.target.checked)}
        />
        Checked bags — adds belt time to the meeting estimate
      </label>

      {error ? <ErrorState error={new Error(error)} title="Not saved" /> : null}

      <div className="flex gap-2">
        <Button disabled={save.isPending} onClick={() => void submit()} className="flex-1">
          {save.isPending ? 'Saving…' : isReturn ? 'Save both directions' : 'Save journey'}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function LegList({
  title,
  legs,
  onUpdate,
  onAdd,
  onRemove,
}: {
  title: string
  legs: LegDraft[]
  onUpdate: (key: string, patch: Partial<LegDraft>) => void
  onAdd: () => void
  onRemove: (key: string) => void
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Plane className="size-4 text-muted-foreground" aria-hidden="true" />
        <h3 className="text-sm font-medium">{title}</h3>
        <span className="text-xs text-muted-foreground">
          {legs.length === 1 ? 'direct' : `${legs.length - 1} stop${legs.length > 2 ? 's' : ''}`}
        </span>
      </div>

      {legs.map((leg, i) => (
        <Card key={leg.key} className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Leg {i + 1}
            </p>
            {legs.length > 1 && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove leg ${i + 1}`}
                onClick={() => onRemove(leg.key)}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Flight number" htmlFor={`num-${leg.key}`}>
              <Input
                id={`num-${leg.key}`}
                placeholder="6E1468"
                value={leg.flightNumber}
                onChange={(e) => onUpdate(leg.key, { flightNumber: e.target.value })}
              />
            </Field>
            <Field label="Date" htmlFor={`date-${leg.key}`}>
              <Input
                id={`date-${leg.key}`}
                type="date"
                value={leg.date}
                onChange={(e) => onUpdate(leg.key, { date: e.target.value })}
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <AirportPicker
              id={`from-${leg.key}`}
              label="From"
              value={leg.originIata}
              onChange={(iata, airport) =>
                onUpdate(leg.key, { originIata: iata, originAirport: airport })
              }
            />
            <AirportPicker
              id={`to-${leg.key}`}
              label="To"
              value={leg.destIata}
              onChange={(iata, airport) =>
                onUpdate(leg.key, { destIata: iata, destAirport: airport })
              }
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label={leg.originAirport ? `Departs (${leg.originAirport.city} time)` : 'Departs'}
              htmlFor={`dep-${leg.key}`}
            >
              <Input
                id={`dep-${leg.key}`}
                type="datetime-local"
                value={leg.departure}
                onChange={(e) => onUpdate(leg.key, { departure: e.target.value })}
              />
            </Field>
            <Field
              label={leg.destAirport ? `Arrives (${leg.destAirport.city} time)` : 'Arrives'}
              htmlFor={`arr-${leg.key}`}
            >
              <Input
                id={`arr-${leg.key}`}
                type="datetime-local"
                value={leg.arrival}
                onChange={(e) => onUpdate(leg.key, { arrival: e.target.value })}
              />
            </Field>
          </div>

          {i < legs.length - 1 && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <TriangleAlert className="size-3" aria-hidden="true" />
              Connects to leg {i + 2}. Once both have times, the app checks the layover.
            </p>
          )}
        </Card>
      ))}

      <Button variant="outline" size="sm" onClick={onAdd}>
        <Plus aria-hidden="true" />
        Add a connecting leg
        <ArrowRight className="size-3" aria-hidden="true" />
      </Button>
    </section>
  )
}

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
