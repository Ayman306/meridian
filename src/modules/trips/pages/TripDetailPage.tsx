'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useParams, usePathname, useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/card'
import { Input, Select } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { EmptyState, ErrorState, PageLoading } from '@/components/common/states'
import { useCouple } from '@/providers/CoupleProvider'
import { cn, pluralise } from '@/lib/utils'
import { todayIn } from '@/lib/dates'
import { useDeleteTrip, useTrip, useTripRealtime, useTripStatuses, useUpdateTrip } from '../hooks'
import { countdownDays, formatTripDates, isLongStay, isStalePlanning, nights } from '../logic'
import { TripDatesEditor } from '../components/TripDatesEditor'
import { TravelerDates } from '../components/TravelerDates'
import { TripAllowanceStrip } from '@/modules/allowance'
import { chosenDestination, useDestinations } from '@/modules/destinations'

const TABS = [
  { segment: 'where', label: 'Where' },
  { segment: 'plan', label: 'Plan' },
  { segment: 'blend', label: 'Blend' },
  { segment: 'map', label: 'Map' },
  { segment: 'docs', label: 'Docs' },
  { segment: 'money', label: 'Money' },
  { segment: 'photos', label: 'Photos' },
] as const

export function TripDetailPage({ children }: { children: React.ReactNode }) {
  const params = useParams<{ id: string }>()
  const id = params.id
  const router = useRouter()
  const pathname = usePathname()
  const { tzSelf } = useCouple()

  const { data: trip, isLoading, error, refetch } = useTrip(id)
  const statuses = useTripStatuses()
  const update = useUpdateTrip(id)
  const remove = useDeleteTrip()

  const [editingTitle, setEditingTitle] = useState(false)
  const [editingDates, setEditingDates] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useTripRealtime(id)

  // The chosen destination is what makes an allowance check possible at all —
  // without a country there is no rule to check against.
  const destinations = useDestinations(id)
  const destinationCountry =
    chosenDestination(destinations.data ?? [])?.country_code ?? null

  if (isLoading) return <PageLoading />
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />
  if (!trip) {
    return (
      <EmptyState
        title="That trip isn't here"
        description="It may have been deleted. Deleted trips are restorable for 30 days."
        action={<Button onClick={() => router.push('/trips')}>Back to trips</Button>}
      />
    )
  }

  const n = nights(trip)
  const today = todayIn(tzSelf)
  const countdown = countdownDays(trip, today)
  const stale = isStalePlanning(trip, today, trip.status?.name)

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          {editingTitle ? (
            <Input
              autoFocus
              defaultValue={trip.title}
              className="max-w-md text-xl font-semibold"
              onBlur={(e) => {
                const value = e.target.value.trim()
                if (value && value !== trip.title) update.mutate({ title: value })
                setEditingTitle(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') setEditingTitle(false)
              }}
            />
          ) : (
            <button
              className="rounded text-left text-2xl font-semibold tracking-tight hover:text-muted-foreground"
              onClick={() => setEditingTitle(true)}
              title="Rename"
            >
              {trip.title}
            </button>
          )}

          <div className="flex items-center gap-2">
            <Select
              aria-label="Status"
              className="h-9 w-auto"
              value={trip.status_id ?? ''}
              onChange={(e) => update.mutate({ status_id: e.target.value || null })}
            >
              <option value="">No status</option>
              {statuses.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Delete trip"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <button
            className="rounded underline-offset-4 hover:underline"
            onClick={() => setEditingDates((v) => !v)}
          >
            {formatTripDates(trip)}
          </button>
          {n !== null && (
            <span>
              {pluralise(n, 'night')} · {pluralise(n + 1, 'day')}
            </span>
          )}
          {isLongStay(trip) && <Badge>Long stay</Badge>}
          {countdown !== null && (
            <span className="tabular font-medium text-foreground">
              {countdown === 0 ? 'Today' : `in ${pluralise(countdown, 'day')}`}
            </span>
          )}
        </div>

        {stale && (
          <p className="rounded-md bg-[hsl(var(--warn))]/10 px-3 py-2 text-sm text-[hsl(var(--warn))]">
            These dates have passed but the trip is still marked “{trip.status?.name}”. Worth
            updating the status.
          </p>
        )}

        {editingDates && (
          <div className="rounded-lg border border-border p-4">
            <TripDatesEditor trip={trip} onDone={() => setEditingDates(false)} />
          </div>
        )}
      </header>

      <TravelerDates trip={trip} />

      {/* Only speaks up when a limit is close or crossed (spec 10.2). */}
      <TripAllowanceStrip
        countryCode={destinationCountry}
        from={trip.date_precision === 'exact' ? trip.start_date : null}
        to={trip.date_precision === 'exact' ? trip.end_date : null}
      />

      <nav className="flex gap-1 border-b border-border" aria-label="Trip sections">
        {TABS.map((tab) => {
          const href = `/trips/${id}/${tab.segment}`
          const active = pathname === href
          return (
            <Link
              key={tab.segment}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'border-foreground text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.label}
            </Link>
          )
        })}
      </nav>

      {children}

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete “${trip.title}”?`}
        description="It goes to the bin for 30 days, along with its itinerary and day notes. Photos are kept and become unfiled."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          await remove.mutateAsync(trip.id)
          setConfirmDelete(false)
          router.push('/trips')
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  )
}
