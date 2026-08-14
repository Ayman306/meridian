/**
 * The live view. Map first, detail beneath. Spec 9.8.
 *
 * There is deliberately **no error state** on this screen. Spec 9.5's
 * degradation ladder ends with "scheduled times only", and that is still a
 * useful screen for someone waiting — so every failure becomes a quiet notice
 * and the page renders regardless.
 */
'use client'

import { useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { Crosshair, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { PageHeader } from '@/components/layout/PageHeader'
import { PersonBadge } from '@/components/PersonBadge'
import { Skeleton } from '@/components/common/states'
import { DualTime } from '@/components/DualTime'
import { formatInZone } from '@/lib/dates'
import { pluralise } from '@/lib/utils'
import { useCouple } from '@/providers/CoupleProvider'
import { HandoffCard } from '../components/HandoffCard'
import {
  useDeleteFlight,
  useFlight,
  useFlightRealtime,
  useFlightRefresh,
  useFlightState,
  useFlightTrack,
  usePrefersReducedMotion,
  useReportWait,
  useStopTracking,
} from '../hooks'
import { PHASE_LABELS, isAirbornePhase, isFinished } from '../logic'
import type { FlightState } from '../types'

const FlightMap = dynamic(() => import('../components/FlightMap').then((m) => m.FlightMap), {
  ssr: false,
  loading: () => <Skeleton className="h-[55vh] w-full rounded-lg" />,
})

export function FlightLivePage({ flightId }: { flightId: string }) {
  const { coupleId, tzSelf, tzPartner, self, partner, partnerRef } = useCouple()
  const flight = useFlight(flightId)
  const state = useFlightState(flight.data)
  const track = useFlightTrack(flightId, Boolean(state && isAirbornePhase(state.phase)))
  const reducedMotion = usePrefersReducedMotion()
  const stopTracking = useStopTracking()
  const remove = useDeleteFlight()
  useFlightRealtime(coupleId)

  const [following, setFollowing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const rows = useMemo(() => (flight.data ? [flight.data] : []), [flight.data])
  const phases = useMemo(() => (state ? { [state.id]: state.phase } : {}), [state])
  const { notices, manualRefresh, canRefresh } = useFlightRefresh(rows, phases)

  const watcherProfile = flight.data?.traveler_id === self?.id ? partner : self
  const watcherHome =
    watcherProfile?.home_lat != null && watcherProfile?.home_lng != null
      ? { lat: Number(watcherProfile.home_lat), lng: Number(watcherProfile.home_lng) }
      : null

  if (flight.isLoading || !state) return <Skeleton className="h-[70vh] w-full rounded-lg" />

  const allNotices = [...state.freshness.notices, ...notices]

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${state.flightNumber} · ${state.origin.iata ?? '???'} → ${state.dest.iata ?? '???'}`}
        description={state.airline.name ?? undefined}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Refresh now"
              title={canRefresh ? 'Refresh now' : 'Just refreshed — try again in a minute'}
              disabled={!canRefresh}
              onClick={manualRefresh}
            >
              <RefreshCw aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Delete flight"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </div>
        }
      />

      <FlightMap
        state={state}
        track={track.data ?? []}
        watcherHome={watcherHome}
        followAircraft={following}
        reducedMotion={reducedMotion}
        className="h-[55vh] w-full overflow-hidden rounded-lg border border-border"
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={following ? 'secondary' : 'ghost'}
          size="sm"
          aria-pressed={following}
          onClick={() => setFollowing(!following)}
        >
          <Crosshair aria-hidden="true" />
          Follow the aircraft
        </Button>
        {state.trackingActive && isFinished(state.phase) && (
          <Button variant="ghost" size="sm" onClick={() => stopTracking.mutate(state.id)}>
            Stop tracking
          </Button>
        )}
      </div>

      {state.handoff && <HandoffCard state={state} timezone={tzSelf} />}

      <Card>
        <CardContent className="space-y-5 py-5">
          <div className="flex flex-wrap items-center gap-3">
            <PersonBadge person={state.traveler} size="sm" withName />
            <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium">
              {PHASE_LABELS[state.phase]}
            </span>
            {state.times.delayMinutes > 0 && (
              <span className="text-sm text-[hsl(var(--warn))]">
                {pluralise(state.times.delayMinutes, 'min')} late
              </span>
            )}
            {state.times.delayMinutes < 0 && (
              <span className="text-sm text-[hsl(var(--ok))]">
                {Math.abs(state.times.delayMinutes)} min early
              </span>
            )}
          </div>

          <Progress state={state} />

          <div className="grid gap-5 sm:grid-cols-2">
            <Leg
              label="Departs"
              airport={state.origin}
              instant={
                state.times.actualDeparture ??
                state.times.estimatedDeparture ??
                state.times.scheduledDeparture
              }
              tzSelf={tzSelf}
              tzPartner={tzPartner}
              partnerName={partnerRef?.displayName ?? 'Them'}
              detail={[
                state.origin.terminal && `Terminal ${state.origin.terminal}`,
                state.origin.gate && `Gate ${state.origin.gate}`,
              ]}
            />
            <Leg
              label="Arrives"
              airport={state.dest}
              instant={
                state.times.actualArrival ??
                state.times.estimatedArrival ??
                state.times.scheduledArrival
              }
              tzSelf={tzSelf}
              tzPartner={tzPartner}
              partnerName={partnerRef?.displayName ?? 'Them'}
              detail={[state.dest.belt && `Belt ${state.dest.belt}`]}
            />
          </div>

          {allNotices.length > 0 && (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {allNotices.map((notice) => (
                <li key={notice}>{notice}</li>
              ))}
            </ul>
          )}

          <p className="text-xs text-muted-foreground">
            Status{' '}
            {state.freshness.status.ageSeconds === null
              ? 'from what you entered'
              : `${Math.round(state.freshness.status.ageSeconds / 60)} min old`}
            {state.position && ` · position ${Math.round(state.position.ageSeconds)}s old`}
          </p>
        </CardContent>
      </Card>

      {isFinished(state.phase) && state.dest.iata && <WaitFeedback iata={state.dest.iata} />}

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${state.flightNumber}?`}
        description="Its position history goes too. This one is not recoverable."
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          remove.mutate(state.id)
          setConfirmDelete(false)
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  )
}

function Progress({ state }: { state: FlightState }) {
  const { progress } = state
  return (
    <div className="space-y-1.5">
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-accent transition-[width]"
          style={{ width: `${Math.round(progress.fraction * 100)}%` }}
        />
      </div>
      <p className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {progress.distanceFlownKm} km flown · {progress.distanceRemainingKm} km to go
        </span>
        <span>
          {progress.minutesRemaining !== null && `${progress.minutesRemaining} min remaining · `}
          {/* Which basis was used matters: a position-derived ETA is
              materially better than one read off a schedule. */}
          {progress.source === 'position' ? 'from the aircraft' : 'from the schedule'}
        </span>
      </p>
    </div>
  )
}

function Leg({
  label,
  airport,
  instant,
  tzSelf,
  tzPartner,
  partnerName,
  detail,
}: {
  label: string
  airport: FlightState['origin']
  instant: string | null
  tzSelf: string
  tzPartner: string
  partnerName: string
  detail: (string | null | undefined | false)[]
}) {
  const parts = detail.filter(Boolean) as string[]

  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium">
        {airport.iata ?? '???'}
        {airport.name && <span className="ml-2 font-normal text-muted-foreground">{airport.name}</span>}
      </p>

      {instant ? (
        <>
          {/* Local to the airport is the number the traveller reads off a
              board; the two home zones are what the couple think in. */}
          {airport.tz && (
            <p className="tabular text-lg">
              {formatInZone(instant, airport.tz, 'HH:mm')}
              <span className="ml-2 text-xs font-normal text-muted-foreground">local</span>
            </p>
          )}
          <DualTime
            tzSelf={tzSelf}
            tzPartner={tzPartner}
            labelPartner={partnerName}
            at={new Date(instant)}
            className="scale-90 origin-left"
          />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">No time yet</p>
      )}

      {parts.length > 0 && <p className="text-sm text-muted-foreground">{parts.join(' · ')}</p>}
    </div>
  )
}

/**
 * "How long did she actually take?" — spec 9.9.
 *
 * One number, once, after an arrival. It writes to the shared airport table,
 * so the next handoff estimate for that airport is measured rather than
 * guessed. The estimate improves with every trip, which is the payoff of
 * building this for two people rather than millions.
 */
function WaitFeedback({ iata }: { iata: string }) {
  const report = useReportWait()
  const [minutes, setMinutes] = useState('')
  const [done, setDone] = useState(false)

  if (done) {
    return (
      <p className="text-sm text-muted-foreground">
        Noted — the next estimate for {iata} will use it.
      </p>
    )
  }

  return (
    <Card>
      <CardContent className="flex flex-wrap items-end gap-3 py-4">
        <div className="mr-auto">
          <p className="text-sm font-medium">How long did it take to get out?</p>
          <p className="text-xs text-muted-foreground">
            Landing to kerb at {iata}. One number now makes every future pickup better.
          </p>
        </div>
        <Input
          type="number"
          inputMode="numeric"
          className="w-24"
          value={minutes}
          placeholder="45"
          aria-label="Minutes from landing to leaving the airport"
          onChange={(e) => setMinutes(e.target.value)}
        />
        <Button
          variant="outline"
          disabled={!minutes || report.isPending}
          onClick={() =>
            report.mutate(
              // Reported end to end; the disembark and walk constants come off
              // the top so what is stored is the queue itself.
              { iata, minutes: { immigration: Math.max(0, Number(minutes) - 25) } },
              { onSuccess: () => setDone(true) },
            )
          }
        >
          Save it
        </Button>
      </CardContent>
    </Card>
  )
}
