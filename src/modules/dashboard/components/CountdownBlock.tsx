'use client'

import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { Countdown } from '../types'

/**
 * The one thing the app exists to answer: when do we next see each other?
 *
 * Every state gets its own sentence rather than a number with a caveat. "NaN
 * days" and "0 days" are both worse than saying what is actually true.
 */
export function CountdownBlock({ countdown }: { countdown: Countdown }) {
  if (countdown.state === 'EMPTY') {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-lg font-medium">No trips yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            A trip needs nothing but a name. Add one and the countdown starts here.
          </p>
          <Link href="/trips/new" className={buttonVariants()}>
            Plan something
          </Link>
        </CardContent>
      </Card>
    )
  }

  const href = countdown.tripId ? `/trips/${countdown.tripId}` : '/trips'

  return (
    <Card>
      <CardContent className="py-8">
        <Link href={href} className="block text-center">
          {countdown.state === 'COUNTDOWN' && countdown.days !== null ? (
            <>
              <div className="tabular text-6xl font-semibold tracking-tight">{countdown.days}</div>
              <p className="mt-1 text-sm text-muted-foreground">
                {countdown.days === 1 ? 'day until' : 'days until'} {countdown.title}
              </p>
            </>
          ) : countdown.state === 'COUNTDOWN' ? (
            <>
              {/* Vague dates get their label, never a number — "247 days" would
                  imply a precision that isn't there. */}
              <div className="text-3xl font-semibold tracking-tight">{countdown.dateLabel}</div>
              <p className="mt-1 text-sm text-muted-foreground">{countdown.title}</p>
            </>
          ) : countdown.state === 'PLANNING' ? (
            <>
              <div className="text-3xl font-semibold tracking-tight">{countdown.title}</div>
              <p className="mt-1 text-sm text-muted-foreground">
                No dates yet — still deciding
              </p>
            </>
          ) : countdown.state === 'TRAVEL_DAY' ? (
            <>
              <div className="text-4xl font-semibold tracking-tight">Today</div>
              <p className="mt-1 text-sm text-muted-foreground">
                Travel day — {countdown.title}
              </p>
            </>
          ) : countdown.state === 'DEPARTING' ? (
            <>
              <div className="text-4xl font-semibold tracking-tight">Last day</div>
              <p className="mt-1 text-sm text-muted-foreground">{countdown.title}</p>
            </>
          ) : (
            <>
              <div className="text-4xl font-semibold tracking-tight">Together</div>
              <p className="mt-1 text-sm text-muted-foreground">
                {countdown.dayOfTotal
                  ? `Day ${countdown.dayOfTotal.day} of ${countdown.dayOfTotal.total} · ${countdown.title}`
                  : countdown.title}
              </p>
            </>
          )}
        </Link>
      </CardContent>
    </Card>
  )
}
