/**
 * Every flight, grouped by whether it is happening. Spec 9.8.
 *
 * Both partners' flights on one list: `traveler_id` says whose it is, not who
 * may see it. The person on the ground is usually the one watching.
 */
'use client'

import { useMemo, useState } from 'react'
import { Plane, Plus, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState, ErrorState, SkeletonList } from '@/components/common/states'
import { useCouple } from '@/providers/CoupleProvider'
import { JourneyBuilder } from '../components/JourneyBuilder'
import { JourneyCard } from '../components/JourneyCard'
import { FlightCard } from '../components/FlightCard'
import {
  useDeleteJourney,
  useFlightRealtime,
  useFlightRefresh,
  useFlightStates,
  useFlights,
  useGroupedFlights,
  useJourneys,
} from '../hooks'
import { GROUP_LABELS, type FlightGroup } from '../logic'
import type { FlightRow } from '../types'

export function FlightsPage() {
  const { coupleId, tzSelf } = useCouple()
  const flights = useFlights()
  const journeys = useJourneys()
  const deleteJourney = useDeleteJourney()
  const [adding, setAdding] = useState(false)

  // Legs that belong to a booking are shown as that booking; anything added
  // one-off still renders below, so nothing is hidden by the grouping.
  const byJourney = useMemo(() => {
    const map = new Map<string, FlightRow[]>()
    for (const flight of flights.data ?? []) {
      if (!flight.journey_id) continue
      const bucket = map.get(flight.journey_id)
      if (bucket) bucket.push(flight)
      else map.set(flight.journey_id, [flight])
    }
    return map
  }, [flights.data])
  useFlightRealtime(coupleId)

  const rows = useMemo(() => flights.data ?? [], [flights.data])
  const states = useFlightStates(rows)
  const phases = useMemo(
    () => Object.fromEntries(states.map((s) => [s.id, s.phase])),
    [states],
  )
  const { notices, manualRefresh, canRefresh } = useFlightRefresh(rows, phases)
  const groups = useGroupedFlights(states)

  const order: FlightGroup[] = ['active', 'upcoming', 'past']

  return (
    <div>
      <PageHeader
        title="Flights"
        description="Both of yours. Whoever is on the ground can watch the other one fly."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Refresh now"
              title={canRefresh ? 'Refresh now' : 'Just refreshed — try again in a minute'}
              disabled={!canRefresh}
              onClick={manualRefresh}
            >
              <RefreshCw aria-hidden="true" />
            </Button>
            {!adding && (
              <Button onClick={() => setAdding(true)}>
                <Plus aria-hidden="true" />
                Add a flight
              </Button>
            )}
          </div>
        }
      />

      {adding && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Add a journey</CardTitle>
          </CardHeader>
          <CardContent>
            <JourneyBuilder onClose={() => setAdding(false)} />
          </CardContent>
        </Card>
      )}

      {notices.length > 0 && (
        <p className="mb-4 text-xs text-muted-foreground">{notices.join(' ')}</p>
      )}

      {/* Bookings first, as bookings. A connection only means anything when
          the legs either side of it are shown together. */}
      {(journeys.data?.length ?? 0) > 0 && (
        <section className="mb-8 space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">Bookings</h2>
          {journeys.data!.map((journey) => (
            <JourneyCard
              key={journey.id}
              journey={journey}
              flights={byJourney.get(journey.id) ?? []}
              onDelete={() => deleteJourney.mutate(journey.id)}
            />
          ))}
        </section>
      )}

      {flights.isLoading ? (
        <SkeletonList rows={3} />
      ) : flights.error ? (
        <ErrorState error={flights.error} onRetry={() => void flights.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Plane className="size-5" aria-hidden="true" />}
          title="No flights yet"
          description="A flight number and a date is enough. Add the airports and it draws the route; add a second leg and it checks the layover."
          action={<Button onClick={() => setAdding(true)}>Add the first one</Button>}
        />
      ) : (
        <div className="space-y-8">
          {order.map((group) =>
            groups[group].length === 0 ? null : (
              <section key={group} className="space-y-3">
                <h2 className="text-sm font-semibold text-muted-foreground">
                  {GROUP_LABELS[group]}
                  <span className="ml-2 font-normal">{groups[group].length}</span>
                </h2>
                <div className="space-y-3">
                  {groups[group].map((state) => (
                    <FlightCard key={state.id} state={state} timezone={tzSelf} />
                  ))}
                </div>
              </section>
            ),
          )}
        </div>
      )}
    </div>
  )
}
