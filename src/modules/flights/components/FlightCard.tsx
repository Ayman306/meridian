'use client'

import Link from 'next/link'
import { Plane } from 'lucide-react'
import { PersonBadge } from '@/components/PersonBadge'
import { formatInZone } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { PHASE_LABELS } from '../logic'
import type { FlightState, Phase } from '../types'

/** Only the phases worth colouring. Everything else reads as ordinary. */
const PHASE_TONE: Partial<Record<Phase, string>> = {
  enroute: 'bg-[hsl(var(--ok))]/15 text-[hsl(var(--ok))]',
  descending: 'bg-[hsl(var(--ok))]/15 text-[hsl(var(--ok))]',
  departed: 'bg-[hsl(var(--ok))]/15 text-[hsl(var(--ok))]',
  boarding: 'bg-[hsl(var(--warn))]/15 text-[hsl(var(--warn))]',
  diverted: 'bg-destructive/10 text-destructive',
  cancelled: 'bg-destructive/10 text-destructive',
}

export function FlightCard({ state, timezone }: { state: FlightState; timezone: string }) {
  const arrival = state.times.actualArrival ?? state.times.estimatedArrival ?? state.times.scheduledArrival
  const delayed = state.times.delayMinutes > 15

  return (
    <Link
      href={`/flights/${state.id}`}
      className="block rounded-lg border border-border p-4 transition-colors hover:bg-secondary/40"
    >
      <div className="flex flex-wrap items-center gap-3">
        <PersonBadge person={state.traveler} size="xs" />

        <span className="font-medium">{state.flightNumber}</span>

        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          {state.origin.iata ?? '???'}
          <Plane className="size-3.5" aria-hidden="true" />
          {state.dest.iata ?? '???'}
        </span>

        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-xs font-medium',
            PHASE_TONE[state.phase] ?? 'bg-secondary text-secondary-foreground',
          )}
        >
          {PHASE_LABELS[state.phase]}
        </span>

        <span className="ml-auto text-sm text-muted-foreground">
          {arrival ? (
            <>
              lands{' '}
              <span className="tabular text-foreground">
                {formatInZone(arrival, timezone, 'HH:mm')}
              </span>{' '}
              your time
            </>
          ) : (
            formatInZone(`${state.times.scheduledDeparture ?? ''}`, timezone, 'd MMM')
          )}
        </span>
      </div>

      {(delayed || state.freshness.degraded) && (
        <p className="mt-2 text-xs text-muted-foreground">
          {delayed && (
            <span className="text-[hsl(var(--warn))]">
              {state.times.delayMinutes} min late.{' '}
            </span>
          )}
          {state.freshness.notices[0]}
        </p>
      )}
    </Link>
  )
}
