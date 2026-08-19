/**
 * The flights belonging to one trip. Spec 9.12.
 *
 * Same cards as `/flights`, filtered to this trip, plus the connection risks
 * between consecutive legs — which is the thing a trip view can say that the
 * global list cannot.
 */
'use client'

import { useMemo, useState } from 'react'
import { Plane, Plus, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState, ErrorState, SkeletonList } from '@/components/common/states'
import { pluralise } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { useCouple } from '@/providers/CoupleProvider'
import { AddFlightForm } from '../components/AddFlightForm'
import { FlightCard } from '../components/FlightCard'
import {
  useAirportCountries,
  useFlightRealtime,
  useFlightStates,
  useFlights,
} from '../hooks'
import { connectionsFor } from '../logic'

export function TripFlightsPage({ tripId }: { tripId: string }) {
  const { coupleId, tzSelf } = useCouple()
  const flights = useFlights()
  const [adding, setAdding] = useState(false)
  useFlightRealtime(coupleId)

  const rows = useMemo(
    () => (flights.data ?? []).filter((f) => f.trip_id === tripId),
    [flights.data, tripId],
  )
  const states = useFlightStates(rows)
  // Tells a domestic connection from an international one, which is the
  // difference between a 60-minute minimum and a 90-minute one.
  const countryOf = useAirportCountries(rows)

  // Legs of one journey, in order. A flight with no journey is a single leg
  // and has nothing to connect to.
  const connections = useMemo(() => {
    const byJourney = new Map<string, typeof rows>()
    for (const flight of rows) {
      if (!flight.journey_id) continue
      const list = byJourney.get(flight.journey_id) ?? []
      list.push(flight)
      byJourney.set(flight.journey_id, list)
    }
    return [...byJourney.values()].flatMap((legs) => connectionsFor(legs, countryOf))
  }, [rows, countryOf])

  const risky = connections.filter((c) => c.risk !== 'ok')

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Flights on this trip</h2>
        {!adding && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus aria-hidden="true" />
            Add a flight
          </Button>
        )}
      </div>

      {adding && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add a flight</CardTitle>
          </CardHeader>
          <CardContent>
            <AddFlightForm tripId={tripId} onClose={() => setAdding(false)} />
          </CardContent>
        </Card>
      )}

      {/* Surfaced as soon as leg 1's delay is known, which is while it can
          still be acted on (spec 9.10). */}
      {risky.map((connection) => (
        <p
          key={`${connection.fromFlightId}-${connection.toFlightId}`}
          className={cn(
            'flex items-start gap-2 rounded-md border p-3 text-sm',
            connection.risk === 'high'
              ? 'border-destructive/40 bg-destructive/5'
              : 'border-[hsl(var(--warn))]/40 bg-[hsl(var(--warn))]/5',
          )}
        >
          <TriangleAlert
            className={cn(
              'mt-0.5 size-4 shrink-0',
              connection.risk === 'high' ? 'text-destructive' : 'text-[hsl(var(--warn))]',
            )}
            aria-hidden="true"
          />
          <span>
            {connection.risk === 'high' ? 'That connection looks unlikely' : 'Tight connection'} —{' '}
            {pluralise(connection.bufferMinutes, 'min')} between legs, against{' '}
            {connection.minimumMinutes} normally needed
            {connection.sameTerminal ? ' in the same terminal' : ' between terminals'}.
          </span>
        </p>
      ))}

      {flights.isLoading ? (
        <SkeletonList rows={2} />
      ) : flights.error ? (
        <ErrorState error={flights.error} onRetry={() => void flights.refetch()} />
      ) : states.length === 0 ? (
        <EmptyState
          icon={<Plane className="size-5" aria-hidden="true" />}
          title="No flights on this trip yet"
          description="Add one and the arrival handoff — when to leave to meet them — works itself out."
          action={<Button onClick={() => setAdding(true)}>Add a flight</Button>}
        />
      ) : (
        <div className="space-y-3">
          {states.map((state) => (
            <FlightCard key={state.id} state={state} timezone={tzSelf} />
          ))}
        </div>
      )}
    </div>
  )
}
