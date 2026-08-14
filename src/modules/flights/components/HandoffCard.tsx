/**
 * "Leave at 19:10", and why. Spec 9.9.
 *
 * The breakdown is not a detail view — it is the thing that makes the number
 * usable. A bare time is unverifiable, so nobody can tell whether it counted
 * baggage; the same figure with its parts is something you can disagree with,
 * which is what makes it worth following.
 */
'use client'

import { AlertTriangle, Car } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { formatInZone } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { describeBreakdown } from '../handoff'
import type { FlightState } from '../types'

export function HandoffCard({ state, timezone }: { state: FlightState; timezone: string }) {
  const plan = state.handoff
  if (!plan) return null

  const voided = Boolean(plan.voidReason)
  const time = (instant: string) => formatInZone(instant, timezone, 'HH:mm')

  return (
    <Card className={cn(voided ? 'border-destructive/50 bg-destructive/5' : 'border-accent/40')}>
      <CardContent className="space-y-4 py-5">
        {voided ? (
          // Loud, because a confidently wrong airport run is the worst thing
          // this module can produce.
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 text-destructive" aria-hidden="true" />
            <div>
              <p className="font-medium text-destructive">Do not set off</p>
              <p className="text-sm text-muted-foreground">{plan.voidReason}</p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <Car className="size-4 text-muted-foreground" aria-hidden="true" />
              <span className="text-sm text-muted-foreground">Leave at</span>
              <span className="tabular text-3xl font-semibold">{time(plan.leaveAt)}</span>
              <span className="text-sm text-muted-foreground">
                to meet {state.traveler?.displayName ?? 'them'} at {time(plan.readyAt)}
              </span>
            </div>

            <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              {describeBreakdown(plan).map((part) => (
                <li key={part.label} className="flex justify-between gap-3">
                  <span className="text-muted-foreground">{part.label}</span>
                  <span className="tabular">{part.minutes} min</span>
                </li>
              ))}
            </ul>

            <p className="text-xs text-muted-foreground">
              {plan.confidence === 'good'
                ? 'Based on a recent update.'
                : 'Rough — the flight data is not fresh, so treat this as approximate.'}{' '}
              Drive time is estimated from the straight-line distance, not a route.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}
