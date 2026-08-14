'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { qk } from '@/lib/queryClient'
import { msUntilMidnightIn, todayIn } from '@/lib/dates'
import { useCouple } from '@/providers/CoupleProvider'
import { useChosenCountry } from '@/modules/destinations'
import { useTripAllowanceCheck } from '@/modules/allowance'
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
 * The stay-allowance alerts for the next trip, if it has a chosen destination.
 *
 * Separate from `useDashboard` on purpose: it needs the allowance rules and
 * the entry log, and putting those in the payload the home screen fetches on
 * every load would slow the screen down for a warning that is usually absent.
 * They resolve a moment after the rest and slot in at priority 3.
 *
 * Returns nothing at all when the trip has no chosen destination — a shortlist
 * of candidate cities has no one country, and warning about the first would be
 * a guess presented as a fact.
 */
export function useAllowanceAlerts(): Alert[] {
  const { selfRef, partnerRef } = useCouple()
  const dashboard = useDashboard()

  const trip = dashboard.data?.next_trip ?? null
  const country = useChosenCountry(trip?.id)
  const checks = useTripAllowanceCheck(
    country.data ?? null,
    trip?.start_date ?? null,
    trip?.end_date ?? null,
  )

  return useMemo(() => {
    if (!trip) return []
    return [selfRef, partnerRef]
      .filter((person): person is NonNullable<typeof person> => person !== null)
      .map((person) => {
        const check = checks[person.id]
        return check ? allowanceAlert(check, person, trip.title) : null
      })
      .filter((alert): alert is Alert => alert !== null)
  }, [checks, selfRef, partnerRef, trip])
}
