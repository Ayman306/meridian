/**
 * The intimacy log. Extends Module 12.
 *
 * The cycle calendar only applies to one of them; this applies to both. What
 * it records is deliberately small — how much you wanted, what you did, how
 * many times, and anything you want to say about it — because a longer form
 * would be answered honestly once and then abandoned.
 *
 * ## What this screen refuses to do
 *
 * **It never scores anybody.** There are counts and one average, and no
 * streaks, no targets, no "you are below your usual". A private log that
 * starts grading you is one you stop keeping, and the numbers here are nobody
 * else's business including the app's.
 *
 * **It never implies the partner is watching.** Nothing says "shared" unless
 * it is, nothing nudges toward sharing, and the sharing switch lives on the
 * Sharing tab with every other consent rather than beside the log where it
 * would read as a prompt.
 *
 * **An unlogged day is not a zero.** It is missing information, and the
 * summary says so — see `summariseIntimacy`.
 */
'use client'

import { useState } from 'react'
import { HeartHandshake, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field, Input, Textarea } from '@/components/ui/input'
import { EmptyState, ErrorState, SkeletonList } from '@/components/common/states'
import { addDaysTo, formatDateOnly, todayIn } from '@/lib/dates'
import { cn, pluralise } from '@/lib/utils'
import { userMessage } from '@/lib/errors'
import { useCouple } from '@/providers/CoupleProvider'
import { DESIRE_LABELS, isEmptyLog, summariseIntimacy } from '../logic'
import { useDeleteIntimacy, useIntimacy, useSaveIntimacy } from '../hooks'
import type { IntimacyLog } from '../types'

const WINDOW_DAYS = 30

export function IntimacyPanel({
  ownerId,
  readOnly = false,
}: {
  ownerId: string
  readOnly?: boolean
}) {
  const { tzSelf } = useCouple()
  const today = todayIn(tzSelf)
  const from = addDaysTo(today, -WINDOW_DAYS + 1)

  const logs = useIntimacy(ownerId)
  const save = useSaveIntimacy()
  const remove = useDeleteIntimacy()

  const [editing, setEditing] = useState<string | null>(null)

  if (logs.isLoading) return <SkeletonList rows={3} />
  if (logs.error) return <ErrorState error={logs.error} title="That did not load" />

  const rows = (logs.data ?? []).filter((row) => !isEmptyLog(row))
  const summary = summariseIntimacy(logs.data ?? [], from, today)

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-5">
        <h3 className="text-sm font-medium">The last {WINDOW_DAYS} days</h3>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
          <Stat label="Days logged" value={`${summary.daysLogged} of ${summary.daysInWindow}`} />
          <Stat
            label="Average desire"
            value={
              summary.averageDesire === null ? '—' : summary.averageDesire.toFixed(1)
            }
            // The denominator travels with the number: an average of 4 over two
            // days and over thirty are different claims.
            hint={
              summary.desireDays === 0
                ? 'Nothing logged yet'
                : `from ${pluralise(summary.desireDays, 'day')}`
            }
          />
          <Stat label="On your own" value={String(summary.solo)} />
          <Stat label="Together" value={String(summary.partnered)} />
        </dl>
        {summary.orgasms > 0 && (
          <p className="text-sm text-muted-foreground">
            {pluralise(summary.orgasms, 'orgasm')} recorded over the period.
          </p>
        )}
      </Card>

      {!readOnly && (
        <DayForm
          key={editing ?? 'today'}
          existing={rows.find((row) => row.id === editing) ?? null}
          defaultDate={today}
          maxDate={today}
          pending={save.isPending}
          error={save.error}
          onCancel={() => setEditing(null)}
          onSave={(input) =>
            save.mutate(input, { onSuccess: () => setEditing(null) })
          }
        />
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={<HeartHandshake className="size-5" aria-hidden="true" />}
          title="Nothing logged"
          description={
            readOnly
              ? 'Nothing recorded, or nothing shared.'
              : 'Log a day above. This is yours alone until you decide otherwise.'
          }
          subtle
        />
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
              <span className="tabular w-28 shrink-0 text-muted-foreground">
                {formatDateOnly(row.logged_on, 'd MMM yyyy')}
              </span>

              {row.desire !== null && (
                <span className="rounded-full bg-secondary px-2 py-0.5 text-xs">
                  {DESIRE_LABELS[row.desire] ?? row.desire}
                </span>
              )}
              {row.solo && <span className="text-xs text-muted-foreground">On your own</span>}
              {row.partnered && <span className="text-xs text-muted-foreground">Together</span>}
              {row.orgasms > 0 && (
                <span className="tabular text-xs text-muted-foreground">
                  {pluralise(row.orgasms, 'orgasm')}
                </span>
              )}
              {row.notes && (
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {row.notes}
                </span>
              )}

              {!readOnly && (
                <span className="ml-auto flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(row.id)}>
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label={`Delete the entry for ${row.logged_on}`}
                    onClick={() => remove.mutate(row.id)}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="tabular text-lg font-semibold">{value}</dd>
      {hint && <dd className="text-xs text-muted-foreground">{hint}</dd>}
    </div>
  )
}

/**
 * One day, new or being corrected.
 *
 * The date defaults to today and cannot be in the future: this records what
 * happened, and a log you can fill in ahead of time is a plan, which is a
 * different and much stranger thing to keep.
 */
function DayForm({
  existing,
  defaultDate,
  maxDate,
  pending,
  error,
  onSave,
  onCancel,
}: {
  existing: IntimacyLog | null
  defaultDate: string
  maxDate: string
  pending: boolean
  error: unknown
  onSave: (input: {
    logged_on: string
    desire: number | null
    solo: boolean
    partnered: boolean
    orgasms: number
    notes: string | null
  }) => void
  onCancel: () => void
}) {
  const [date, setDate] = useState(existing?.logged_on ?? defaultDate)
  const [desire, setDesire] = useState<number | null>(existing?.desire ?? null)
  const [solo, setSolo] = useState(existing?.solo ?? false)
  const [partnered, setPartnered] = useState(existing?.partnered ?? false)
  const [orgasms, setOrgasms] = useState(String(existing?.orgasms ?? 0))
  const [notes, setNotes] = useState(existing?.notes ?? '')

  const count = Number(orgasms)
  const countOk = Number.isInteger(count) && count >= 0 && count <= 50

  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{existing ? 'Edit that day' : 'Log a day'}</h3>
        {existing && (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            New entry instead
          </Button>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Day" htmlFor="intimacy-date">
          <Input
            id="intimacy-date"
            type="date"
            value={date}
            max={maxDate}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field label="Times you came" hint="Leave at zero if none" htmlFor="intimacy-orgasms">
          <Input
            id="intimacy-orgasms"
            inputMode="numeric"
            value={orgasms}
            onChange={(e) => setOrgasms(e.target.value)}
          />
        </Field>
      </div>

      <fieldset>
        <legend className="mb-2 text-sm">How much did you want it?</legend>
        <div className="flex flex-wrap gap-1.5">
          {/* Clearing is its own button rather than a sixth value: "I did not
              think about it" and "not at all" are different answers, and the
              average only counts the second. */}
          {Object.entries(DESIRE_LABELS).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={desire === Number(value)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs transition-colors',
                desire === Number(value)
                  ? 'border-accent bg-accent/10 font-medium'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
              onClick={() => setDesire(Number(value))}
            >
              {label}
            </button>
          ))}
          {desire !== null && (
            <button
              type="button"
              className="rounded-full px-3 py-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
              onClick={() => setDesire(null)}
            >
              Clear
            </button>
          )}
        </div>
      </fieldset>

      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={solo}
            onChange={(e) => setSolo(e.target.checked)}
          />
          On your own
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={partnered}
            onChange={(e) => setPartnered(e.target.checked)}
          />
          Together
        </label>
      </div>

      <Field label="Anything worth remembering" htmlFor="intimacy-notes">
        <Textarea
          id="intimacy-notes"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>

      {!countOk && (
        <p className="text-sm text-destructive" role="alert">
          That needs to be a whole number between 0 and 50.
        </p>
      )}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {userMessage(error)}
        </p>
      ) : null}

      <Button
        disabled={pending || !date || !countOk}
        onClick={() =>
          onSave({
            logged_on: date,
            desire,
            solo,
            partnered,
            orgasms: count,
            notes: notes.trim() || null,
          })
        }
      >
        {pending ? 'Saving…' : 'Save the day'}
      </Button>
    </Card>
  )
}
