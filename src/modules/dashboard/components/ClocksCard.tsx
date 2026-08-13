'use client'

import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { PersonBadge } from '@/components/PersonBadge'
import { formatInZone, haversineKmSafe } from '../format'
import { isDaylight } from '../logic'
import type { PersonRef } from '@/types/domain'
import type { Profile } from '@/types/domain'

/**
 * Two clocks, or one when they are in the same place.
 *
 * Ticks on the minute boundary rather than every 60s from mount, so the two
 * readings never drift apart on screen. Only this component re-renders — spec
 * 2.7 asks for the clocks to update without re-rendering the page.
 */
export function ClocksCard({
  self,
  partner,
  selfRef,
  partnerRef,
}: {
  self: Profile | null
  partner: Profile | null
  selfRef: PersonRef | null
  partnerRef: PersonRef | null
}) {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>
    const schedule = () => {
      const ms = 60_000 - (Date.now() % 60_000)
      timeout = setTimeout(() => {
        setNow(new Date())
        schedule()
      }, ms + 50)
    }
    schedule()
    return () => clearTimeout(timeout)
  }, [])

  const tzSelf = self?.timezone ?? 'UTC'
  const tzPartner = partner?.timezone ?? tzSelf
  const sameZone = tzSelf === tzPartner

  const distance = haversineKmSafe(
    self?.home_lat,
    self?.home_lng,
    partner?.home_lat,
    partner?.home_lng,
  )

  return (
    <Card>
      <CardContent className="flex flex-wrap items-start justify-between gap-6 pt-5">
        <Clock
          person={selfRef}
          label={self?.home_city ?? 'You'}
          tz={tzSelf}
          now={now}
          lat={self?.home_lat ?? null}
          lng={self?.home_lng ?? null}
        />

        {!sameZone && partner && (
          <Clock
            person={partnerRef}
            label={partner.home_city ?? partner.display_name ?? 'Them'}
            tz={tzPartner}
            now={now}
            lat={partner.home_lat}
            lng={partner.home_lng}
          />
        )}

        <div className="text-right">
          {sameZone ? (
            <>
              <div className="text-2xl font-semibold tracking-tight">Together</div>
              <p className="text-xs text-muted-foreground">Same time zone</p>
            </>
          ) : distance !== null ? (
            <>
              <div className="tabular text-2xl font-semibold tracking-tight">
                {Math.round(distance).toLocaleString()}
              </div>
              <p className="text-xs text-muted-foreground">km apart</p>
            </>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

function Clock({
  person,
  label,
  tz,
  now,
  lat,
  lng,
}: {
  person: PersonRef | null
  label: string
  tz: string
  now: Date
  lat: number | null
  lng: number | null
}) {
  const daylight = isDaylight(now, lat, lng)

  return (
    <div className="flex items-start gap-2.5">
      <PersonBadge person={person} size="sm" />
      <div>
        <div className="flex items-center gap-1.5">
          <span className="tabular text-2xl font-semibold">{formatInZone(now, tz, 'HH:mm')}</span>
          {daylight !== null &&
            (daylight ? (
              <Sun className="size-3.5 text-[hsl(var(--warn))]" aria-label="Daytime" />
            ) : (
              <Moon className="size-3.5 text-muted-foreground" aria-label="Night" />
            ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {label} · {formatInZone(now, tz, 'EEE d MMM')}
        </p>
      </div>
    </div>
  )
}
