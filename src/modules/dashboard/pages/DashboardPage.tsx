'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { CalendarPlus, FileText, MapPin } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ErrorState, Skeleton, SkeletonList } from '@/components/common/states'
import { useCouple } from '@/providers/CoupleProvider'
import { pluralise } from '@/lib/utils'
import { useAllowanceAlerts, useDashboard, useToday } from '../hooks'
import { buildAlerts, countdown, nightsTogether } from '../logic'
import { CountdownBlock } from '../components/CountdownBlock'
import { ClocksCard } from '../components/ClocksCard'
import { AlertStrip } from '../components/AlertStrip'

export function DashboardPage() {
  const { self, partner, selfRef, partnerRef, tzSelf } = useCouple()
  const { data, isLoading, error, refetch } = useDashboard()
  // Resolves a moment after the payload and slots in at priority 3.
  const allowanceAlerts = useAllowanceAlerts()

  // Rolls over at the viewer's midnight, not the server's (spec 2.6).
  const today = useToday(tzSelf)

  const view = useMemo(() => {
    if (!data) return null
    return {
      countdown: countdown(data, today),
      alerts: [...buildAlerts(data, today), ...allowanceAlerts].sort(
        (a, b) => a.priority - b.priority,
      ),
      nights: nightsTogether(data.together_windows ?? [], today),
    }
  }, [data, today, allowanceAlerts])

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-24 w-full" />
        <SkeletonList rows={2} />
      </div>
    )
  }

  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />
  if (!view || !data) return null

  return (
    <div className="space-y-6">
      {view.alerts.length > 0 && <AlertStrip alerts={view.alerts} />}

      <CountdownBlock countdown={view.countdown} />

      <ClocksCard self={self} partner={partner} selfRef={selfRef} partnerRef={partnerRef} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="pt-5">
            <div className="tabular text-3xl font-semibold">{view.nights.thisYear}</div>
            <p className="text-sm text-muted-foreground">
              {pluralise(view.nights.thisYear, 'night')} together in {today.slice(0, 4)}
            </p>
            {view.nights.lifetime > view.nights.thisYear && (
              <p className="mt-1 text-xs text-muted-foreground">
                {view.nights.lifetime.toLocaleString()} in all
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-2 pt-5">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              Quick actions
            </span>
            <div className="flex flex-wrap gap-2">
              <Link href="/trips/new" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                <CalendarPlus aria-hidden="true" />
                New trip
              </Link>
              {view.countdown.tripId && (
                <Link
                  href={`/trips/${view.countdown.tripId}/plan`}
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                >
                  <MapPin aria-hidden="true" />
                  Plan
                </Link>
              )}
              <Link
                href="/documents"
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                <FileText aria-hidden="true" />
                Documents
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
