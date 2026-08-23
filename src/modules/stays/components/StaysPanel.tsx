/**
 * Where they sleep, on the same screen as where they go.
 *
 * It lives on the Where tab rather than getting a ninth of its own. The
 * distinction is the point: destinations answer *which city*, stays answer
 * *which bed*, and the two decisions are made minutes apart.
 *
 * The one thing this screen actively does for you is count. Nobody notices an
 * unbooked Tuesday in the middle of a fortnight by reading a list of bookings,
 * and finding out at 11pm is the worst possible time — so the gaps are computed
 * and stated, in nights, above everything else.
 */
'use client'

import { useState } from 'react'
import { BedDouble, Pencil, Plus, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge, Card, CardContent } from '@/components/ui/card'
import { Input, Select } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { EmptyState, ErrorState, SkeletonList } from '@/components/common/states'
import { formatDateOnly, type DateOnly } from '@/lib/dates'
import { pluralise } from '@/lib/utils'
import { PlacePicker, PlaceSearch } from '@/modules/map'
import { useAddStay, useRemoveStay, useStays, useStaysRealtime, useUpdateStay } from '../hooks'
import {
  KIND_LABELS,
  describeStay,
  nightsAt,
  overlappingStays,
  sortStays,
  uncoveredNights,
} from '../logic'
import type { Accommodation } from '../types'

export interface StaysPanelProps {
  tripId: string
  startDate: DateOnly | null
  endDate: DateOnly | null
}

export function StaysPanel({ tripId, startDate, endDate }: StaysPanelProps) {
  const stays = useStays(tripId)
  const remove = useRemoveStay(tripId)
  useStaysRealtime(tripId)
  const [editing, setEditing] = useState<Accommodation | null>(null)
  const [adding, setAdding] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<Accommodation | null>(null)

  const rows = sortStays(stays.data ?? [])
  const gaps = uncoveredNights(startDate, endDate, rows)
  const clashes = overlappingStays(rows)

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <BedDouble className="size-4" aria-hidden="true" />
            Where you sleep
          </h2>
          {!adding && !editing && (
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              <Plus aria-hidden="true" />
              Add a stay
            </Button>
          )}
        </div>

        {gaps.length > 0 && rows.length > 0 && (
          <p className="rounded-md bg-[hsl(var(--warn))]/10 px-3 py-2 text-sm text-[hsl(var(--warn))]">
            {pluralise(
              gaps.reduce((total, gap) => total + gap.nights, 0),
              'night',
            )}{' '}
            with nowhere booked:{' '}
            {gaps
              .map((gap) =>
                gap.nights === 1
                  ? formatDateOnly(gap.from, 'd MMM')
                  : `${formatDateOnly(gap.from, 'd MMM')}–${formatDateOnly(gap.to, 'd MMM')}`,
              )
              .join(', ')}
            .
          </p>
        )}

        {clashes.length > 0 && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Two bookings cover the same {pluralise(clashes[0]!.nights, 'night')} from{' '}
            {formatDateOnly(clashes[0]!.from, 'd MMM')} — {clashes[0]!.a.name} and{' '}
            {clashes[0]!.b.name}. Worth checking one was not cancelled.
          </p>
        )}

        {(adding || editing) && (
          <StayForm
            tripId={tripId}
            stay={editing}
            defaultCheckIn={startDate}
            onDone={() => {
              setAdding(false)
              setEditing(null)
            }}
          />
        )}

        {stays.isLoading ? (
          <SkeletonList rows={2} />
        ) : stays.error ? (
          <ErrorState error={stays.error} onRetry={() => void stays.refetch()} />
        ) : rows.length === 0 ? (
          !adding && (
            <EmptyState
              title="Nowhere booked yet"
              description="Add where you are staying and it shows up on every day of the journey — with the address, so neither of you has to dig out the email."
              action={<Button onClick={() => setAdding(true)}>Add a stay</Button>}
            />
          )
        ) : (
          <ul className="space-y-2">
            {rows.map((stay) => (
              <li
                key={stay.id}
                className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-border p-3"
              >
                <div className="min-w-0 space-y-1">
                  <p className="font-medium">{stay.name}</p>
                  <p className="text-sm text-muted-foreground">{describeStay(stay)}</p>
                  {stay.check_in && (
                    <p className="text-xs text-muted-foreground">
                      {formatDateOnly(stay.check_in, 'EEE d MMM')}
                      {stay.check_out && ` → ${formatDateOnly(stay.check_out, 'EEE d MMM')}`}
                    </p>
                  )}
                  {stay.address && <p className="text-xs text-muted-foreground">{stay.address}</p>}
                  {stay.booking_ref && <Badge>Ref {stay.booking_ref}</Badge>}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Edit ${stay.name}`}
                    onClick={() => {
                      setAdding(false)
                      setEditing(stay)
                    }}
                  >
                    <Pencil aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${stay.name}`}
                    onClick={() => setConfirmDelete(stay)}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <ConfirmDialog
        open={confirmDelete !== null}
        title={`Remove ${confirmDelete?.name ?? 'this stay'}?`}
        description="It goes to the bin rather than being erased — a booking reference is not something you can remember back."
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          if (confirmDelete) await remove.mutateAsync(confirmDelete.id)
          setConfirmDelete(null)
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </Card>
  )
}

/**
 * One booking.
 *
 * No coordinate field, here or anywhere: searching for the hotel by name gives
 * the app the pin and the full address at once (D94), and dragging the pin
 * re-resolves the address rather than leaving a stale one behind.
 */
function StayForm({
  tripId,
  stay,
  defaultCheckIn,
  onDone,
}: {
  tripId: string
  stay: Accommodation | null
  defaultCheckIn: DateOnly | null
  onDone: () => void
}) {
  const add = useAddStay(tripId)
  const update = useUpdateStay(tripId)

  const [name, setName] = useState(stay?.name ?? '')
  const [kind, setKind] = useState(stay?.kind ?? 'hotel')
  const [checkIn, setCheckIn] = useState(stay?.check_in ?? defaultCheckIn ?? '')
  const [checkOut, setCheckOut] = useState(stay?.check_out ?? '')
  const [ref, setRef] = useState(stay?.booking_ref ?? '')
  const [place, setPlace] = useState({
    address: stay?.address ?? null,
    city: stay?.city ?? null,
    country_code: stay?.country_code ?? null,
    lat: stay?.lat ?? null,
    lng: stay?.lng ?? null,
  })

  const nights = nightsAt({ check_in: checkIn || null, check_out: checkOut || null })
  const pending = add.isPending || update.isPending
  // The database refuses a zero-night stay; saying so before the round trip is
  // the difference between a hint and an error.
  const datesOk = !checkIn || !checkOut || checkOut > checkIn

  async function save() {
    const payload = {
      name: name.trim(),
      kind,
      check_in: checkIn || null,
      check_out: checkOut || null,
      booking_ref: ref.trim() || null,
      ...place,
    }
    if (stay) await update.mutateAsync({ id: stay.id, patch: payload })
    else await add.mutateAsync(payload)
    onDone()
  }

  return (
    <form
      className="space-y-3 rounded-lg border border-border p-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (name.trim() && datesOk) void save()
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{stay ? 'Edit stay' : 'New stay'}</h3>
        <Button variant="ghost" size="icon" aria-label="Cancel" onClick={onDone}>
          <X aria-hidden="true" />
        </Button>
      </div>

      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground">Find it by name</span>
        <PlaceSearch
          placeholder="Search for the hotel or address"
          onPick={(hit) => {
            if (!name.trim()) setName(hit.name)
            setPlace({
              address: hit.displayName,
              city: hit.city,
              country_code: hit.countryCode,
              lat: hit.lat,
              lng: hit.lng,
            })
          }}
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">Name</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">Kind</span>
          <Select value={kind} onChange={(e) => setKind(e.target.value)}>
            {Object.entries(KIND_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">Check in</span>
          <Input type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">Check out</span>
          <Input type="date" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
        </label>
        <label className="block space-y-1 sm:col-span-2">
          <span className="text-xs text-muted-foreground">
            Booking reference — the thing you need at a front desk at 1am
          </span>
          <Input value={ref} onChange={(e) => setRef(e.target.value)} />
        </label>
      </div>

      {nights !== null && datesOk && (
        <p className="text-xs text-muted-foreground">{pluralise(nights, 'night')}.</p>
      )}
      {!datesOk && (
        <p className="text-xs text-destructive">
          Check-out has to be after check-in — a stay covers nights, not days.
        </p>
      )}

      {place.lat !== null && (
        <PlacePicker
          lat={place.lat}
          lng={place.lng}
          title={name || 'This stay'}
          address={place.address}
          onMove={(at) => setPlace((p) => ({ ...p, ...at, address: null }))}
          onAddressResolved={(hit) =>
            setPlace((p) => ({
              ...p,
              address: hit.displayName,
              city: hit.city ?? p.city,
              country_code: hit.countryCode ?? p.country_code,
            }))
          }
          onClear={() =>
            setPlace({ address: null, city: null, country_code: null, lat: null, lng: null })
          }
        />
      )}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending || !name.trim() || !datesOk}>
          {stay ? 'Save' : 'Add'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
