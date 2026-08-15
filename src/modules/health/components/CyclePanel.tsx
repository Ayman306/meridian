/**
 * The cycle log, its history, and the estimate.
 *
 * Spec 12.6 forbids gamification, streaks and celebratory styling, so there is
 * none: no charts of "your best month", no colour that reads as praise or
 * concern. It is a list of dates and one carefully-worded estimate.
 *
 * The estimate is rendered through `describePrediction` rather than by pulling
 * the date out of the object, so the variance and the "estimate" wording
 * cannot be dropped by a component that only wanted the day.
 */
'use client'

import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { EmptyState, ErrorState, SkeletonList } from '@/components/common/states'
import { formatInZone, todayIn } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { useCouple } from '@/providers/CoupleProvider'
import {
  FERTILITY_DISCLAIMER,
  cycleLengths,
  describeFertility,
  describePrediction,
  periodLength,
  predictFertility,
} from '../logic'
import { useCycles, useDeleteCycle, useLogCycle, usePrediction, useUpdateCycle } from '../hooks'
import type { Flow } from '../types'

const FLOWS: Flow[] = ['light', 'medium', 'heavy']

export function CyclePanel({
  ownerId,
  readOnly = false,
}: {
  ownerId: string
  /** The partner's view. Read-only, and visibly so (spec 12.6). */
  readOnly?: boolean
}) {
  const { tzSelf } = useCouple()
  const cycles = useCycles(ownerId)
  const prediction = usePrediction(ownerId)
  const log = useLogCycle()
  const update = useUpdateCycle()
  const remove = useDeleteCycle()

  const [adding, setAdding] = useState(false)
  const [startedOn, setStartedOn] = useState(todayIn(tzSelf))
  const [endedOn, setEndedOn] = useState('')
  const [flow, setFlow] = useState<Flow | ''>('')

  if (cycles.isLoading) return <SkeletonList rows={3} />
  if (cycles.error) return <ErrorState error={cycles.error} title="That did not load" />

  const rows = cycles.data ?? []
  const lengths = cycleLengths(rows)
  const fertility = predictFertility(prediction, rows)
  const latest = rows[0] ?? null

  return (
    <div className="space-y-4">
      <Card className="space-y-2 p-5">
        <h3 className="text-sm font-medium">Next one</h3>
        <p className="text-sm text-muted-foreground">{describePrediction(prediction)}</p>
        {prediction.available && (
          <p className="text-xs text-muted-foreground">
            Average cycle {prediction.averageLength} days over the last {prediction.basedOn}.
            {prediction.confidence === 'irregular' &&
              ' These have varied a lot, so the window is wide.'}
          </p>
        )}
        <p className="pt-1 text-xs text-muted-foreground">
          An estimate from what has been logged, not medical advice.
        </p>
      </Card>

      {/* The fertile window. Calendar arithmetic, labelled as such in every
          branch, and never framed as contraception or as advice on conceiving
          — those are regulated claims and this app does not make them. */}
      {fertility && (
        <Card className="space-y-2 p-5">
          <h3 className="text-sm font-medium">Fertile window</h3>
          <p className="text-sm text-muted-foreground">{describeFertility(fertility)}</p>

          {!readOnly && latest && (
            <div className="space-y-1 border-t border-border pt-3">
              <label htmlFor="ovulation-on" className="text-sm">
                Recorded ovulation for the cycle starting {latest.started_on}
              </label>
              <Input
                id="ovulation-on"
                type="date"
                min={latest.started_on}
                defaultValue={latest.ovulation_on ?? ''}
                onBlur={(e) => {
                  const value = e.target.value || null
                  if (value !== (latest.ovulation_on ?? null)) {
                    update.mutate({ id: latest.id, patch: { ovulation_on: value } })
                  }
                }}
              />
              <p className="text-xs text-muted-foreground">
                If you tested or took your temperature, put the day here. What you record replaces
                what the app worked out, and the next estimate learns from it.
              </p>
            </div>
          )}

          <p className="pt-1 text-xs text-muted-foreground">{FERTILITY_DISCLAIMER}</p>
        </Card>
      )}

      {!readOnly && (
        <>
          {adding ? (
            <Card className="space-y-3 p-5">
              <h3 className="text-sm font-medium">Log a cycle</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label htmlFor="cycle-start" className="text-sm">
                    Started
                  </label>
                  <Input
                    id="cycle-start"
                    type="date"
                    value={startedOn}
                    onChange={(e) => setStartedOn(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="cycle-end" className="text-sm">
                    Ended
                  </label>
                  <Input
                    id="cycle-end"
                    type="date"
                    min={startedOn}
                    value={endedOn}
                    onChange={(e) => setEndedOn(e.target.value)}
                  />
                </div>
              </div>

              <fieldset className="space-y-1">
                <legend className="text-sm">Flow</legend>
                <div className="flex gap-2">
                  {FLOWS.map((option) => (
                    <label
                      key={option}
                      className={cn(
                        'flex-1 cursor-pointer rounded-md border px-3 py-2 text-center text-sm capitalize',
                        flow === option ? 'border-accent bg-accent/10' : 'border-input',
                      )}
                    >
                      <input
                        type="radio"
                        name="flow"
                        value={option}
                        className="sr-only"
                        checked={flow === option}
                        onChange={() => setFlow(option)}
                      />
                      {option}
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="flex gap-2">
                <Button
                  disabled={log.isPending}
                  onClick={() =>
                    log.mutate(
                      {
                        started_on: startedOn,
                        ended_on: endedOn || null,
                        flow: flow || null,
                      },
                      {
                        onSuccess: () => {
                          setAdding(false)
                          setEndedOn('')
                          setFlow('')
                        },
                      },
                    )
                  }
                >
                  {log.isPending ? 'Saving…' : 'Save'}
                </Button>
                <Button variant="ghost" onClick={() => setAdding(false)}>
                  Cancel
                </Button>
              </div>
              {log.error ? <ErrorState error={log.error} title="That did not save" /> : null}
            </Card>
          ) : (
            <Button variant="outline" onClick={() => setAdding(true)}>
              <Plus aria-hidden="true" />
              Log a cycle
            </Button>
          )}
        </>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-medium">History</h3>
        {rows.length === 0 ? (
          <EmptyState
            title="Nothing logged"
            description={
              readOnly
                ? 'Nothing has been logged, or nothing is shared.'
                : 'Log three and an estimate appears.'
            }
            subtle
          />
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {rows.map((row, i) => {
              const length = periodLength(row)
              // `rows` is newest first; the gap belongs to the older neighbour.
              const gap = lengths[lengths.length - i]
              return (
                <li key={row.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <p>{formatInZone(`${row.started_on}T12:00:00Z`, tzSelf, 'd MMM yyyy')}</p>
                    <p className="text-xs text-muted-foreground">
                      {length ? `${length} days` : 'no end date'}
                      {row.flow && ` · ${row.flow}`}
                      {gap !== undefined && ` · ${gap} days after the one before`}
                    </p>
                  </div>
                  {!readOnly && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete the cycle starting ${row.started_on}`}
                      onClick={() => remove.mutate(row.id)}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
