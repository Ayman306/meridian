/**
 * Putting an already-saved flight onto a trip. Spec 9.12.
 *
 * A flight added from `/flights` carries `trip_id: null`, and until now
 * nothing could ever change it: the trip view filters on `trip_id`, so a
 * booking logged before the trip existed — which is the normal order, you book
 * the flight and then plan around it — stayed invisible to the trip forever.
 * The only workaround was deleting it and adding it again from inside the
 * trip, losing its tracking history with it.
 *
 * Nothing attaches on its own. The date-matched flights are offered first and
 * one of them may be preselected, but the row only moves when the user presses
 * the button (Part 15: nothing auto-inserts).
 */
'use client'

import { useMemo } from 'react'
import { Link2, Plane } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PersonBadge } from '@/components/PersonBadge'
import { userMessage } from '@/lib/errors'
import { formatInZone } from '@/lib/dates'
import { useCouple } from '@/providers/CoupleProvider'
import { attachableFlights, flightFallsInTrip } from '../logic'
import { useFlights, useUpdateFlight } from '../hooks'
import type { FlightRow } from '../types'

export function AttachFlightPanel({
  tripId,
  tripStart,
  tripEnd,
  onClose,
}: {
  tripId: string
  tripStart: string | null
  tripEnd: string | null
  onClose: () => void
}) {
  const { selfRef, partnerRef } = useCouple()
  const flights = useFlights()
  const update = useUpdateFlight()

  const trip = useMemo(
    () => ({ id: tripId, start_date: tripStart, end_date: tripEnd }),
    [tripId, tripStart, tripEnd],
  )
  const candidates = useMemo(
    () => attachableFlights(flights.data ?? [], trip),
    [flights.data, trip],
  )

  const personFor = (id: string | null) =>
    [selfRef, partnerRef].find((p) => p?.id === id) ?? null

  const attach = async (flight: FlightRow) => {
    await update.mutateAsync({ id: flight.id, patch: { trip_id: tripId } })
  }

  if (flights.isLoading) {
    return <p className="text-sm text-muted-foreground">Looking for flights…</p>
  }

  if (candidates.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Every flight you have saved is already on this trip. Add a new one instead.
        </p>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Flights you have already saved. The ones whose date falls inside this trip are first.
      </p>

      <ul className="divide-y divide-border rounded-lg border border-border">
        {candidates.map((flight) => {
          const inWindow = flightFallsInTrip(flight.flight_date, trip)
          const spokenFor = flight.trip_id !== null
          return (
            <li key={flight.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
              <PersonBadge person={personFor(flight.traveler_id)} size="xs" />
              <span className="font-medium">{flight.flight_number}</span>
              <span className="flex items-center gap-1.5 text-muted-foreground">
                {flight.origin_iata ?? '???'}
                <Plane className="size-3.5" aria-hidden="true" />
                {flight.dest_iata ?? '???'}
              </span>
              <span className="text-xs text-muted-foreground">
                {flight.flight_date
                  ? formatInZone(`${flight.flight_date}T00:00:00Z`, 'UTC', 'd MMM yyyy')
                  : 'No date'}
              </span>

              {inWindow && (
                <span className="rounded-full bg-[hsl(var(--ok))]/15 px-2 py-0.5 text-[11px] text-[hsl(var(--ok))]">
                  Matches these dates
                </span>
              )}
              {/* Moving a leg off another trip is a real edit, not a mistake to
                  hide — but it should never happen without the user seeing it. */}
              {spokenFor && (
                <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                  On another trip
                </span>
              )}

              <Button
                variant="outline"
                size="sm"
                className="ml-auto"
                disabled={update.isPending}
                onClick={() => void attach(flight)}
              >
                <Link2 aria-hidden="true" />
                {spokenFor ? 'Move here' : 'Add to trip'}
              </Button>
            </li>
          )
        })}
      </ul>

      {update.error && (
        <p className="text-sm text-destructive" role="alert">
          {userMessage(update.error)}
        </p>
      )}

      <Button variant="ghost" onClick={onClose}>
        Done
      </Button>
    </div>
  )
}
