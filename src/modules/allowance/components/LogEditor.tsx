'use client'

import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, Input, Textarea } from '@/components/ui/input'
import { userMessage } from '@/lib/errors'
import { isValidDateOnly } from '@/lib/dates'
import { useLogEntry, useUpdateLogEntry } from '../hooks'
import type { EntryExitLog } from '../types'

/**
 * Adding or correcting a crossing by hand.
 *
 * Two dates and a country code, and the exit date is optional because "still
 * there" is a real state that the count has to handle — it is what makes the
 * page's answer change overnight.
 *
 * Editing is the reason the exit date can be filled in later: the common case
 * is logging an entry on arrival and coming back to close it on the way home.
 * Deleting and re-adding the row would work, but a crossing is an immigration
 * record and retyping one is how the dates end up wrong.
 */
export function LogEditor({
  entry,
  onClose,
}: {
  entry?: EntryExitLog | null
  onClose: () => void
}) {
  const add = useLogEntry()
  const update = useUpdateLogEntry()
  // Scoped so a list can hold an open editor per row without two of them
  // fighting over the same `id`.
  const uid = useId()
  const [country, setCountry] = useState(entry?.country_code ?? '')
  const [entered, setEntered] = useState(entry?.entered_on ?? '')
  const [exited, setExited] = useState(entry?.exited_on ?? '')
  const [notes, setNotes] = useState(entry?.notes ?? '')
  const [error, setError] = useState<string | null>(null)
  const pending = add.isPending || update.isPending

  const submit = () => {
    setError(null)
    if (country.trim().length !== 2) return setError('Use the two-letter country code, e.g. PT.')
    if (!isValidDateOnly(entered)) return setError('An entry date is needed.')
    if (exited && !isValidDateOnly(exited)) return setError('That exit date is not a real date.')
    if (exited && exited < entered) return setError('The exit date is before the entry date.')

    if (entry) {
      update.mutate(
        {
          id: entry.id,
          patch: {
            country_code: country.trim().toUpperCase(),
            entered_on: entered,
            exited_on: exited || null,
            notes: notes.trim() || null,
            // A hand-corrected row is no longer a guess, whatever it started
            // as: the estimate is what the user just overruled.
            is_estimated: false,
          },
        },
        { onSuccess: onClose },
      )
      return
    }

    add.mutate(
      {
        countryCode: country.trim().toUpperCase(),
        enteredOn: entered,
        exitedOn: exited || null,
        isEstimated: false,
        // Collected since this form was written and dropped on the floor
        // until now.
        notes: notes.trim() || null,
      },
      { onSuccess: onClose },
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Country" hint="Two-letter code" htmlFor={`log-country-${uid}`}>
          <Input
            id={`log-country-${uid}`}
            value={country}
            maxLength={2}
            className="uppercase"
            placeholder="PT"
            onChange={(e) => setCountry(e.target.value)}
          />
        </Field>
        <Field label="Entered" htmlFor={`log-entered-${uid}`}>
          <Input
            id={`log-entered-${uid}`}
            type="date"
            value={entered}
            onChange={(e) => setEntered(e.target.value)}
          />
        </Field>
        <Field label="Exited" hint="Leave blank if still there" htmlFor={`log-exited-${uid}`}>
          <Input
            id={`log-exited-${uid}`}
            type="date"
            value={exited}
            onChange={(e) => setExited(e.target.value)}
          />
        </Field>
      </div>

      <Field label="Notes" htmlFor={`log-notes-${uid}`}>
        <Textarea
          id={`log-notes-${uid}`}
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>

      {(error || add.error || update.error) && (
        <p className="text-sm text-destructive" role="alert">
          {error ?? userMessage(add.error ?? update.error)}
        </p>
      )}

      <div className="flex gap-2">
        <Button onClick={submit} disabled={pending}>
          {pending ? 'Saving…' : entry ? 'Save changes' : 'Add to the log'}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
