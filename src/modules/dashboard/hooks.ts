'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { qk } from '@/lib/queryClient'
import { msUntilMidnightIn, todayIn } from '@/lib/dates'
import { useCouple } from '@/providers/CoupleProvider'
import { useTripsAhead } from '@/modules/allowance'
import { allowanceAlert } from './logic'
import type { Alert } from './types'
import * as api from './api'

export function useDashboard() {
  const { coupleId } = useCouple()
  return useQuery({
    queryKey: qk.dashboard,
    queryFn: api.getDashboard,
    enabled: Boolean(coupleId),
    // Window focus already refetches; the countdown only changes at midnight.
    staleTime: 60_000,
  })
}

/**
 * The viewer's calendar date, rolling over at *their* midnight.
 *
 * A countdown that says "3 days" at 23:59 must say "2 days" a minute later,
 * and the answer differs for the two people looking (spec 2.6). A fixed
 * interval would either burn renders all day or drift past the boundary, so
 * this schedules a single timeout to the next local midnight and re-arms.
 */
export function useToday(timezone: string): string {
  // The date is *derived* from the zone and a tick, never mirrored into state.
  // Storing it would mean writing to state from the effect body — a cascading
  // render, and one more thing that can disagree with the clock.
  const [tick, setTick] = useState(0)
  const qc = useQueryClient()

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const schedule = () => {
      timer = setTimeout(
        () => {
          setTick((n) => n + 1)
          // Yesterday's "next trip" may be today's active one.
          void qc.invalidateQueries({ queryKey: qk.dashboard })
          schedule()
        },
        // A second past midnight, so the date has definitely turned over.
        msUntilMidnightIn(timezone) + 1000,
      )
    }
    schedule()
    return () => clearTimeout(timer)
  }, [timezone, qc])

  // eslint-disable-next-line react-hooks/exhaustive-deps -- tick is the trigger
  return useMemo(() => todayIn(timezone), [timezone, tick])
}

/**
 * The stay-allowance alerts for every upcoming trip, for both partners.
 *
 * Separate from `useDashboard` on purpose: it needs the allowance rules, the
 * entry log and the planned trips, and putting those in the payload the home
 * screen fetches on every load would slow the screen down for a warning that
 * is usually absent. They resolve a moment after the rest and slot in at
 * priority 3.
 *
 * Every upcoming trip, not only the next: a visa limit is usually broken by
 * the *second* visit inside a window, and warning about it only once it is
 * next is warning after it has been booked. Each check counts the person's
 * other plans as well as their log (D140). A trip with only a shortlist of
 * candidate cities is skipped — it has no one country, and warning about the
 * first would be a guess presented as a fact.
 */
export function useAllowanceAlerts(): Alert[] {
  const { selfRef, partnerRef } = useCouple()
  const ahead = useTripsAhead()

  return useMemo(() => {
    const people = [selfRef, partnerRef].filter(
      (person): person is NonNullable<typeof person> => person !== null,
    )
    return ahead
      .map(({ trip, userId, check }) => {
        const person = people.find((p) => p.id === userId)
        return person ? allowanceAlert(check, person, trip) : null
      })
      .filter((alert): alert is Alert => alert !== null)
  }, [ahead, selfRef, partnerRef])
}
