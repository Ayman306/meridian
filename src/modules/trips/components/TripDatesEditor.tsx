/**
 * Editing a trip's dates rebuilds its day grid. Shortening is the dangerous
 * direction: days can carry itinerary items, and the spec is explicit that we
 * prompt rather than silently delete.
 */
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { pluralise } from '@/lib/utils'
import { userMessage } from '@/lib/errors'
import type { DateOnly } from '@/lib/dates'
import { diffTripDays } from '../logic'
import { itemCountsByDay } from '../api'
import { useSetTripDates } from '../hooks'
import type { DatePrecision, TripDetail } from '../types'

const PRECISIONS: { value: DatePrecision; label: string }[] = [
  { value: 'exact', label: 'Exact dates' },
  { value: 'month', label: 'A month' },
  { value: 'season', label: 'A season' },
  { value: 'year', label: 'A year' },
  { value: 'unknown', label: 'No idea yet' },
]

export function TripDatesEditor({ trip, onDone }: { trip: TripDetail; onDone: () => void }) {
  const setDates = useSetTripDates(trip.id)
  const [start, setStart] = useState<DateOnly | ''>((trip.start_date as DateOnly) ?? '')
  const [end, setEnd] = useState<DateOnly | ''>((trip.end_date as DateOnly) ?? '')
  const [precision, setPrecision] = useState<DatePrecision>(trip.date_precision as DatePrecision)
  const [openEnded, setOpenEnded] = useState(trip.is_open_ended)
  const [pendingRemoval, setPendingRemoval] = useState<DateOnly[] | null>(null)
  const [atRiskItems, setAtRiskItems] = useState(0)

  const commit = async () => {
    await setDates.mutateAsync({
      start: start || null,
      end: openEnded ? null : end || null,
      precision,
      isOpenEnded: openEnded,
    })
    setPendingRemoval(null)
    onDone()
  }

  const onSave = async () => {
    const { toRemove } = diffTripDays(
      trip.days.map((d) => d.date as DateOnly),
      start || null,
      openEnded ? null : end || null,
      openEnded,
    )

    // Only days carrying something are worth pausing over: a scheduled item,
    // a note, or a day type the user set by hand.
    const counts = await itemCountsByDay(trip.id)
    const meaningful = toRemove.filter((date) => {
      if ((counts[date] ?? 0) > 0) return true
      const day = trip.days.find((d) => d.date === date)
      return Boolean(day && (day.day_type !== 'open' || day.title || day.note))
    })

    if (meaningful.length > 0) {
      setPendingRemoval(meaningful)
      setAtRiskItems(meaningful.reduce((sum, d) => sum + (counts[d] ?? 0), 0))
      return
    }
    await commit()
  }

  return (
    <div className="space-y-4">
      <Field label="Date precision" htmlFor="edit-precision">
        <Select
          id="edit-precision"
          value={precision}
          onChange={(e) => setPrecision(e.target.value as DatePrecision)}
        >
          {PRECISIONS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </Select>
      </Field>

      {precision !== 'unknown' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Start" htmlFor="edit-start">
            <Input
              id="edit-start"
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value as DateOnly)}
            />
          </Field>
          {precision === 'exact' && !openEnded && (
            <Field label="End" htmlFor="edit-end">
              <Input
                id="edit-end"
                type="date"
                value={end}
                min={start || undefined}
                onChange={(e) => setEnd(e.target.value as DateOnly)}
              />
            </Field>
          )}
        </div>
      )}

      {precision === 'exact' && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={openEnded}
            onChange={(e) => setOpenEnded(e.target.checked)}
          />
          Open-ended
        </label>
      )}

      {setDates.error ? (
        <p className="text-sm text-destructive" role="alert">
          {userMessage(setDates.error)}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button onClick={() => void onSave()} disabled={setDates.isPending}>
          {setDates.isPending ? 'Saving…' : 'Save dates'}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>

      <ConfirmDialog
        open={pendingRemoval !== null}
        title="Some days would be dropped"
        description={
          pendingRemoval
            ? `${pluralise(pendingRemoval.length, 'day')} you've marked up fall outside the new dates: ${pendingRemoval
                .slice(0, 5)
                .join(', ')}${pendingRemoval.length > 5 ? '…' : ''}.` +
              (atRiskItems > 0
                ? ` ${pluralise(atRiskItems, 'scheduled item')} goes back to the idea pool rather than being deleted. Notes and day types on those days do not survive.`
                : ' Their notes and day types go with them.')
            : undefined
        }
        confirmLabel="Drop them"
        destructive
        onConfirm={() => void commit()}
        onCancel={() => setPendingRemoval(null)}
      />
    </div>
  )
}
