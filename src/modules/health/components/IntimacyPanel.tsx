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
import {
  DESIRE_LABELS,
  HISTORY_DAYS,
  isEmptyLog,
  planDaySave,
  summariseIntimacy,
} from '../logic'
import { useCreateIntimacy, useDeleteIntimacy, useIntimacy, useUpdateIntimacy } from '../hooks'
import type { DaySavePlan } from '../logic'
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
  const since = addDaysTo(today, -HISTORY_DAYS + 1)

  const logs = useIntimacy(ownerId, since)
  const create = useCreateIntimacy()
  const update = useUpdateIntimacy()
  const remove = useDeleteIntimacy()

  const [editing, setEditing] = useState<string | null>(null)

  if (logs.isLoading) return <SkeletonList rows={3} />
  if (logs.error) return <ErrorState error={logs.error} title="That did not load" />

  // An all-empty row cannot be saved from this form any more, but one could
  // exist from before. The summary and the list count the same rows, so the
  // card never claims days the list does not show.
  const rows = (logs.data ?? []).filter((row) => !isEmptyLog(row))
  const summary = summariseIntimacy(rows, from, today)

  // The form opens on the row being edited, or on today's entry if there is
  // one — a blank form over an existing day is how the morning's log got wiped.
  const todayRow = rows.find((row) => row.logged_on === today) ?? null
  const subject = (editing ? rows.find((row) => row.id === editing) : todayRow) ?? null

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
          // Remount whenever the row under the form changes — including when
          // today's entry is first created — so the form never holds values
          // for a row it no longer describes.
          key={subject?.id ?? 'new'}
          existing={subject}
          defaultDate={today}
          maxDate={today}
          pending={create.isPending || update.isPending}
          error={create.error ?? update.error}
          onCancel={() => setEditing(null)}
          onEditInstead={(id) => setEditing(id)}
          plan={(date) => planDaySave(rows, subject?.id ?? null, date)}
          onCreate={(input) => create.mutate(input, { onSuccess: () => setEditing(null) })}
          onUpdate={(id, patch) =>
            update.mutate({ id, patch }, { onSuccess: () => setEditing(null) })
          }
        />
      )}

      {remove.error ? (
        <p className="text-sm text-destructive" role="alert">
          That entry was not deleted — {userMessage(remove.error)}
        </p>
      ) : null}

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
        <>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            The last year
          </h3>
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
                      // A hard delete of the most private row in the app: no
                      // double-fire while one is in flight, and a failure is
                      // said out loud above rather than left to look like it
                      // worked.
                      disabled={remove.isPending}
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
        </>
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
 *
 * What a save does is decided by `planDaySave` rather than by the database: a
 * conflict with another day's entry is shown as a choice — edit that one — and
 * never resolved by overwriting it.
 */
type DayInput = {
  logged_on: string
  desire: number | null
  solo: boolean
  partnered: boolean
  orgasms: number
  notes: string | null
}

function DayForm({
  existing,
  defaultDate,
  maxDate,
  pending,
  error,
  plan,
  onCreate,
  onUpdate,
  onCancel,
  onEditInstead,
}: {
  existing: IntimacyLog | null
  defaultDate: string
  maxDate: string
  pending: boolean
  error: unknown
  plan: (date: string) => DaySavePlan
  onCreate: (input: DayInput) => void
  onUpdate: (id: string, patch: DayInput) => void
  onCancel: () => void
  onEditInstead: (id: string) => void
}) {
  const [date, setDate] = useState(existing?.logged_on ?? defaultDate)
  const [desire, setDesire] = useState<number | null>(existing?.desire ?? null)
  const [solo, setSolo] = useState(existing?.solo ?? false)
  const [partnered, setPartnered] = useState(existing?.partnered ?? false)
  const [orgasms, setOrgasms] = useState(String(existing?.orgasms ?? 0))
  const [notes, setNotes] = useState(existing?.notes ?? '')

  const count = Number(orgasms)
  const countOk = Number.isInteger(count) && count >= 0 && count <= 50
  const input: DayInput = {
    logged_on: date,
    desire,
    solo,
    partnered,
    orgasms: countOk ? count : 0,
    notes: notes.trim() || null,
  }
  // Nothing recorded is not an entry. Saving it would add a day the list
  // hides and the summary would have to argue with.
  const empty = isEmptyLog(input)
  const decision = date ? plan(date) : null

  const save = () => {
    if (!decision || decision.kind === 'conflict') return
    if (decision.kind === 'update') onUpdate(decision.id, input)
    else onCreate(input)
  }

  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">
          {existing
            ? existing.logged_on === defaultDate
              ? 'Today, so far'
              : 'Edit that day'
            : 'Log a day'}
        </h3>
        {existing && existing.logged_on !== defaultDate && (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Back to today
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

      {decision?.kind === 'conflict' && (
        <p className="flex flex-wrap items-center gap-2 text-sm" role="alert">
          <span>
            {formatDateOnly(decision.existing.logged_on, 'd MMM')} already has an entry, and saving
            here would replace it.
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onEditInstead(decision.existing.id)}
          >
            Edit that day instead
          </Button>
        </p>
      )}

      {existing && empty && (
        <p className="text-sm text-muted-foreground">
          Nothing left on this day — delete the entry from the list below instead.
        </p>
      )}

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {userMessage(error)}
        </p>
      ) : null}

      <Button
        disabled={
          pending || !date || !countOk || empty || !decision || decision.kind === 'conflict'
        }
        onClick={save}
      >
        {pending ? 'Saving…' : existing ? 'Save changes' : 'Save the day'}
      </Button>
    </Card>
  )
}
