/**
 * One instant, two zones. Used everywhere — the app's signature component.
 *
 * When both people are in the same zone it collapses to a single reading; a
 * couple standing in the same room should not be shown two identical clocks.
 */
'use client'

import { useEffect, useState } from 'react'
import { dualTime, formatInZone } from '@/lib/dates'
import { cn } from '@/lib/utils'

export interface DualTimeProps {
  /** The instant to render. Defaults to now, ticking every minute. */
  at?: string | Date
  tzSelf: string
  tzPartner: string
  labelSelf?: string
  labelPartner?: string
  /** Show the weekday + date under each time. */
  withDate?: boolean
  className?: string
}

export function DualTime({
  at,
  tzSelf,
  tzPartner,
  labelSelf = 'You',
  labelPartner = 'Them',
  withDate = false,
  className,
}: DualTimeProps) {
  const live = at === undefined
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    if (!live) return
    // Tick on the minute boundary, not every 60s from mount, so the two clocks
    // never drift apart visually.
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
  }, [live])

  const instant = at ?? now
  const { a, b, sameDay, dayOffset } = dualTime(instant, tzSelf, tzPartner)
  const together = tzSelf === tzPartner

  if (together) {
    return (
      <div className={cn('flex flex-col', className)}>
        <span className="tabular text-2xl font-semibold">{a}</span>
        {withDate && (
          <span className="text-xs text-muted-foreground">
            {formatInZone(instant, tzSelf, 'EEE d MMM')}
          </span>
        )}
      </div>
    )
  }

  return (
    <div className={cn('flex items-start gap-6', className)}>
      <Clock label={labelSelf} time={a} tz={tzSelf} at={instant} withDate={withDate} />
      <Clock
        label={labelPartner}
        time={b}
        tz={tzPartner}
        at={instant}
        withDate={withDate}
        offset={sameDay ? 0 : dayOffset}
      />
    </div>
  )
}

function Clock({
  label,
  time,
  tz,
  at,
  withDate,
  offset = 0,
}: {
  label: string
  time: string
  tz: string
  at: string | Date
  withDate: boolean
  offset?: number
}) {
  return (
    <div className="flex flex-col">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="tabular text-2xl font-semibold">
        {time}
        {offset !== 0 && (
          <sup className="ml-1 text-xs font-medium text-accent-foreground/70">
            {offset > 0 ? `+${offset}` : offset}
          </sup>
        )}
      </span>
      {withDate && (
        <span className="text-xs text-muted-foreground">{formatInZone(at, tz, 'EEE d MMM')}</span>
      )}
    </div>
  )
}
