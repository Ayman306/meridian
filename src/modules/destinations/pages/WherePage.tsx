/**
 * The destination board. Spec Module 4.
 *
 * A comparison workspace, not a recommender: it lays candidates side by side
 * and shows what differs. It does not rank them unless somebody asks, it never
 * mentions a price, and a rejected candidate stays on the board because the
 * reasoning for a decision outlives the decision.
 */
'use client'

import { useMemo, useState } from 'react'
import { Compass, Plus, Scale } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { EmptyState, ErrorState, SkeletonList } from '@/components/common/states'
import { todayIn } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { zoneFor } from '@/lib/zones'
import { useCouple } from '@/providers/CoupleProvider'
import { PlaceSearch } from '@/modules/map'
import { useTrip } from '@/modules/trips'
import {
  ALLOWANCE_DISCLAIMER,
  checkPlannedStay,
  ruleFor,
  staysForRule,
  useAllowanceRules,
  useEntryLog,
  type AllowanceCheck,
} from '@/modules/allowance'
import { AdvisoryNote } from '@/modules/allowance'
import { BoardTable } from '../components/BoardTable'
import { ScoringPanel } from '../components/ScoringPanel'
import {
  buildBoard,
  isEqualDistance,
  rankColumns,
  scoringEnabled,
  sortDestinations,
  tripMonth,
  ZERO_WEIGHTS,
  type Traveller,
} from '../logic'
import {
  useAddCandidate,
  useBoardReference,
  useChooseDestination,
  useDestinations,
  useRemoveDestination,
  useSaveWeights,
  useWeights,
  useWishlistCities,
} from '../hooks'
import type { BoardColumn } from '../types'

export function WherePage({ tripId }: { tripId: string }) {
  const { self, partner, selfRef, partnerRef, tzSelf } = useCouple()
  const { data: trip } = useTrip(tripId)
  const destinations = useDestinations(tripId)
  const wishlistCities = useWishlistCities()
  const weightsQuery = useWeights()
  const saveWeights = useSaveWeights()
  const addCandidate = useAddCandidate(tripId)
  const choose = useChooseDestination(tripId)
  const remove = useRemoveDestination(tripId)
  const allowanceRules = useAllowanceRules()
  const entryLog = useEntryLog()

  const [adding, setAdding] = useState(false)
  const [equalOnly, setEqualOnly] = useState(false)
  const [weightsOpen, setWeightsOpen] = useState(false)

  const people = useMemo(
    () => [selfRef, partnerRef].filter((p): p is NonNullable<typeof p> => p !== null),
    [selfRef, partnerRef],
  )

  const travellers = useMemo<Traveller[]>(
    () =>
      [self, partner].filter(Boolean).map((person) => ({
        userId: person!.id,
        home:
          person!.home_lat !== null && person!.home_lng !== null
            ? { lat: Number(person!.home_lat), lng: Number(person!.home_lng) }
            : null,
        passports: [person!.nationality, person!.second_nationality],
      })),
    [self, partner],
  )

  const rows = useMemo(() => sortDestinations(destinations.data ?? []), [destinations.data])
  const passports = useMemo(
    () => travellers.flatMap((t) => t.passports).filter((p): p is string => Boolean(p)),
    [travellers],
  )
  const countries = useMemo(() => rows.map((r) => r.country_code), [rows])
  const reference = useBoardReference(passports, countries, [])

  const weights = weightsQuery.data ?? ZERO_WEIGHTS
  const month = tripMonth(trip?.start_date ?? null, trip?.date_precision ?? null)

  const columns = useMemo(
    () =>
      buildBoard({
        destinations: rows,
        travellers,
        visaRules: reference.visaRules,
        wishlistCountFor: (destination) =>
          wishlistCities.data?.[destination.city.trim().toLowerCase()] ?? 0,
        month,
        weights,
      }),
    [rows, travellers, reference.visaRules, wishlistCities.data, month, weights],
  )

  const visible = useMemo(() => {
    const lensed = equalOnly ? columns.filter(isEqualDistance) : columns
    return scoringEnabled(weights) ? rankColumns(lensed) : lensed
  }, [columns, equalOnly, weights])

  /**
   * Allowance headroom per candidate (spec 4.2's last board row).
   *
   * Computed here rather than through the module's own hook because that one
   * takes a single country and the board has one per column — six candidates
   * would be six hooks, which is not a thing React allows.
   */
  const allowanceFor = (column: BoardColumn, personId: string): AllowanceCheck | null => {
    const country = column.destination.country_code
    const from = column.destination.arrive_on ?? trip?.start_date ?? null
    const to = column.destination.depart_on ?? trip?.end_date ?? null
    if (!country || !from || !to || trip?.date_precision !== 'exact') return null

    const person = [self, partner].find((p) => p?.id === personId)
    if (!person) return null

    const rule = ruleFor(allowanceRules.data ?? [], person.id, country, [
      person.nationality,
      person.second_nationality,
    ])
    const theirLog = (entryLog.data ?? []).filter((row) => row.user_id === person.id)
    const stays = rule ? staysForRule(theirLog, rule) : []
    return checkPlannedStay(stays, from, to, rule, todayIn(tzSelf))
  }

  if (destinations.isLoading) return <SkeletonList rows={3} />
  if (destinations.error) {
    return <ErrorState error={destinations.error} onRetry={() => void destinations.refetch()} />
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {!adding && (
          <Button onClick={() => setAdding(true)}>
            <Plus aria-hidden="true" />
            Add a candidate
          </Button>
        )}

        {columns.length > 1 && (
          <Button
            variant={equalOnly ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={equalOnly}
            onClick={() => setEqualOnly(!equalOnly)}
          >
            <Scale aria-hidden="true" />
            Equal distance only
          </Button>
        )}
      </div>

      {adding && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add a candidate</CardTitle>
          </CardHeader>
          <CardContent>
            <CandidateForm
              onCancel={() => setAdding(false)}
              pending={addCandidate.isPending}
              onAdd={(input) => addCandidate.mutate(input, { onSuccess: () => setAdding(false) })}
            />
          </CardContent>
        </Card>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={<Compass className="size-5" aria-hidden="true" />}
          title="No candidates yet"
          description="Add a couple of cities and this compares them: how far each of you flies, whose journey is longer, what the paperwork looks like, and how long you may each stay."
          action={<Button onClick={() => setAdding(true)}>Add the first one</Button>}
        />
      ) : (
        <>
          <BoardTable
            columns={visible}
            people={people}
            allowanceFor={allowanceFor}
            showScores={scoringEnabled(weights)}
            onChoose={(column, chosen) => choose.mutate({ id: column.destination.id, chosen })}
            onRemove={(column) => remove.mutate(column.destination.id)}
          />

          {equalOnly && visible.length === 0 && (
            <EmptyState
              title="None of these are within two hours of each other"
              description="Turn the lens off to see them all again."
              subtle
            />
          )}

          <ScoringPanel
            weights={weights}
            open={weightsOpen}
            onToggle={() => setWeightsOpen(!weightsOpen)}
            onChange={(next) => saveWeights.mutate(next)}
          />

          <AdvisoryNote text={ALLOWANCE_DISCLAIMER} />
        </>
      )}
    </div>
  )
}

function CandidateForm({
  onAdd,
  onCancel,
  pending,
}: {
  onAdd: (input: {
    city: string
    country_code: string | null
    lat: number | null
    lng: number | null
    timezone: string | null
  }) => void
  onCancel: () => void
  pending: boolean
}) {
  const [city, setCity] = useState('')
  const [picked, setPicked] = useState<{
    country_code: string | null
    lat: number | null
    lng: number | null
  } | null>(null)

  return (
    <div className="space-y-4">
      <PlaceSearch
        placeholder="Search for a city"
        onPick={(place) => {
          setCity(place.city ?? place.name)
          setPicked({ country_code: place.countryCode, lat: place.lat, lng: place.lng })
        }}
      />

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-muted-foreground">
          City
          <Input
            className="mt-1 w-56"
            value={city}
            placeholder="Lisbon"
            onChange={(e) => setCity(e.target.value)}
          />
        </label>

        <span
          className={cn(
            'pb-2 text-xs',
            picked ? 'text-muted-foreground' : 'text-[hsl(var(--warn))]',
          )}
        >
          {/* Confirms it is located without reciting the numbers. Two decimals
              of latitude is not something anybody can check, and the only
              question here is whether the place was found at all. */}
          {picked
            ? `Located${picked.country_code ? ` in ${picked.country_code}` : ''}`
            : 'Pick one from the search — without a location there are no flight times'}
        </span>
      </div>

      <div className="flex gap-2">
        <Button
          disabled={!city.trim() || pending}
          onClick={() =>
            onAdd({
              city: city.trim(),
              country_code: picked?.country_code ?? null,
              lat: picked?.lat ?? null,
              lng: picked?.lng ?? null,
              // A zone is not a timezone; the trip takes the city's zone when
              // this candidate is chosen, and Module 4's tz-lookup lands with
              // the coordinates it needs in a later pass.
              timezone: null,
            })
          }
        >
          {pending ? 'Adding…' : 'Add to the board'}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

/** Exported for the trip header, which shows where a trip landed. */
export function destinationZone(countryCode: string | null): string | null {
  return zoneFor(countryCode)
}
