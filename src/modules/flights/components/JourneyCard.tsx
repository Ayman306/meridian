/**
 * A booking, shown as the thing it is: a route with stops, not loose flights.
 *
 * The layover warning is the reason this component exists. `connectionRisk`
 * has been written and tested since phase 10 and nothing ever rendered it,
 * because nothing knew which flights connected. Now that legs belong to a
 * journey in order, a 50-minute transfer in Mumbai can be pointed at before
 * somebody is standing in it.
 */
'use client'

import Link from 'next/link'
import { ArrowRight, Plane, TriangleAlert, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatInZone } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { useCouple } from '@/providers/CoupleProvider'
import { PersonBadge } from '@/components/PersonBadge'
import { describeJourney, summariseJourney } from '../logic'
import type { FlightRow, Journey } from '../types'

export function JourneyCard({
  journey,
  flights,
  onDelete,
}: {
  journey: Journey
  flights: FlightRow[]
  onDelete?: () => void
}) {
  const { selfRef, partnerRef, tzSelf } = useCouple()
  const summary = summariseJourney(flights)
  const traveller = journey.traveler_id === selfRef?.id ? selfRef : partnerRef

  if (summary.legs.length === 0) return null

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <PersonBadge person={traveller} size="xs" />
        <span className="rounded bg-secondary px-1.5 py-0.5 text-xs text-muted-foreground">
          {journey.direction === 'outbound' ? 'Out' : 'Back'}
        </span>
        <p className="min-w-0 flex-1 truncate text-sm font-medium">
          {describeJourney(summary)}
        </p>
        {journey.booking_ref && (
          <code className="text-xs text-muted-foreground">{journey.booking_ref}</code>
        )}
        {onDelete && (
          <Button variant="ghost" size="icon" aria-label="Delete this journey" onClick={onDelete}>
            <Trash2 className="size-4" aria-hidden="true" />
          </Button>
        )}
      </div>

      {summary.totalMinutes !== null && (
        <p className="text-xs text-muted-foreground">
          {Math.floor(summary.totalMinutes / 60)}h {summary.totalMinutes % 60}m door to door
          {summary.stops.length > 0 && ', layovers included'}
        </p>
      )}

      <ol className="space-y-2">
        {summary.legs.map(({ flight, connection }) => (
          <li key={flight.id} className="space-y-2">
            {/* The connection sits above the leg it feeds into, which is where
                somebody looks when they are worried about making it. */}
            {connection && (
              <div
                className={cn(
                  'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs',
                  connection.risk === 'high'
                    ? 'bg-destructive/10 text-destructive'
                    : connection.risk === 'tight'
                      ? 'bg-amber-500/10 text-amber-700 dark:text-amber-500'
                      : 'text-muted-foreground',
                )}
              >
                {connection.risk !== 'ok' && (
                  <TriangleAlert className="size-3 shrink-0" aria-hidden="true" />
                )}
                {Math.floor(connection.bufferMinutes / 60)}h {connection.bufferMinutes % 60}m to
                connect
                {connection.risk === 'high' && ` — under the ${connection.minimumMinutes} minutes usually needed`}
                {connection.risk === 'tight' && ' — tight'}
              </div>
            )}

            <Link
              href={`/flights/${flight.id}`}
              className="flex items-center gap-3 rounded-md border border-border px-3 py-2 hover:bg-secondary/50"
            >
              <Plane className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">
                  {flight.flight_number} · {flight.origin_iata ?? '???'}{' '}
                  <ArrowRight className="inline size-3" aria-hidden="true" />{' '}
                  {flight.dest_iata ?? '???'}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {flight.scheduled_departure
                    ? formatInZone(
                        flight.scheduled_departure,
                        flight.origin_tz ?? tzSelf,
                        'EEE d MMM, HH:mm',
                      )
                    : 'No time yet'}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ol>
    </Card>
  )
}
