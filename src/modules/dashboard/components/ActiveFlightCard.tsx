/**
 * A flight in the air, on the front page.
 *
 * Reserved on the dashboard since Phase 5 and left empty because it waited on
 * Phase 10. Phase 10 shipped and this did not, so the one moment the app most
 * needs to be useful — one of them is in the air right now — was the moment it
 * showed a countdown to a date that had already arrived.
 *
 * Only ever renders when something is actually happening. A dashboard block
 * that says "no flights today" every day is a block people stop reading, and
 * then do not read on the day it matters.
 */
'use client'

import Link from 'next/link'
import { Plane } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { useCouple } from '@/providers/CoupleProvider'
import { ACTIVE_PHASES, FlightCard, useFlightStates, useFlights } from '@/modules/flights'

export function ActiveFlightCard() {
  const { tzSelf } = useCouple()
  const flights = useFlights()
  const states = useFlightStates(flights.data ?? [])

  // Boarding through landing. A flight scheduled for this evening is not
  // "active" — the countdown block above already covers anticipation, and this
  // is for the hours somebody is actually watching.
  const active = states.filter((state) => ACTIVE_PHASES.includes(state.phase))
  if (active.length === 0) return null

  return (
    <Card>
      <CardContent className="space-y-3 pt-5">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <Plane className="size-4" aria-hidden="true" />
          {active.length === 1 ? 'In the air now' : 'In the air now'}
        </h2>

        {/* At most two. Both of you flying is the case this exists for; three
            would mean the dashboard has become the flights page. */}
        {active.slice(0, 2).map((state) => (
          <FlightCard key={state.id} state={state} timezone={tzSelf} />
        ))}

        {active.length > 2 && (
          <Link
            href="/flights"
            className="block text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            {active.length - 2} more in the air
          </Link>
        )}
      </CardContent>
    </Card>
  )
}
