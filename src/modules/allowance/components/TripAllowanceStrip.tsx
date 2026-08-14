/**
 * The allowance check on the trip itself (spec 10.5: "Inline — warning banner
 * on trip and destination screens").
 *
 * It appears at planning time, which is the only time it is useful: telling
 * someone they have overstayed is not a feature, telling them a trip they are
 * about to book would put them over is. Silent when there is nothing to say.
 */
'use client'

import { useCouple } from '@/providers/CoupleProvider'
import { useTripAllowanceCheck } from '../hooks'
import { AllowanceWarning } from './AllowanceWarning'

export function TripAllowanceStrip({
  countryCode,
  from,
  to,
}: {
  countryCode: string | null
  from: string | null
  to: string | null
}) {
  const { selfRef, partnerRef } = useCouple()
  const checks = useTripAllowanceCheck(countryCode, from, to)

  const worth = Object.entries(checks).filter(
    ([, check]) => check.verdict === 'breach' || check.verdict === 'tight',
  )
  // An allowance that comfortably fits is not news. Only the tight and the
  // broken earn space on a screen someone is trying to plan on.
  if (worth.length === 0) return null

  return (
    <div className="space-y-2">
      {worth.map(([userId, check]) => (
        <AllowanceWarning
          key={userId}
          check={check}
          person={userId === selfRef?.id ? selfRef : partnerRef}
        />
      ))}
    </div>
  )
}
