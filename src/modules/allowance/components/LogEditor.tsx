'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, Input, Textarea } from '@/components/ui/input'
import { userMessage } from '@/lib/errors'
import { isValidDateOnly } from '@/lib/dates'
import { useLogEntry } from '../hooks'

/**
 * Adding a crossing by hand.
 *
 * Two dates and a country code, and the exit date is optional because "still
 * there" is a real state that the count has to handle — it is what makes the
 * page's answer change overnight.
 */
export function LogEditor({ onClose }: { onClose: () => void }) {
  const add = useLogEntry()
  const [country, setCountry] = useState('')
  const [entered, setEntered] = useState('')
  const [exited, setExited] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    setError(null)
    if (country.trim().length !== 2) return setError('Use the two-letter country code, e.g. PT.')
    if (!isValidDateOnly(entered)) return setError('An entry date is needed.')
    if (exited && !isValidDateOnly(exited)) return setError('That exit date is not a real date.')
    if (exited && exited < entered) return setError('The exit date is before the entry date.')

    add.mutate(
      {
        countryCode: country.trim().toUpperCase(),
        enteredOn: entered,
        exitedOn: exited || null,
        isEstimated: false,
      },
      { onSuccess: onClose },
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Country" hint="Two-letter code" htmlFor="log-country">
          <Input
            id="log-country"
            value={country}
            maxLength={2}
            className="uppercase"
            placeholder="PT"
            onChange={(e) => setCountry(e.target.value)}
          />
        </Field>
        <Field label="Entered" htmlFor="log-entered">
          <Input
            id="log-entered"
            type="date"
            value={entered}
            onChange={(e) => setEntered(e.target.value)}
          />
        </Field>
        <Field label="Exited" hint="Leave blank if still there" htmlFor="log-exited">
          <Input
            id="log-exited"
            type="date"
            value={exited}
            onChange={(e) => setExited(e.target.value)}
          />
        </Field>
      </div>

      <Field label="Notes" htmlFor="log-notes">
        <Textarea
          id="log-notes"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>

      {(error || add.error) && (
        <p className="text-sm text-destructive" role="alert">
          {error ?? userMessage(add.error)}
        </p>
      )}

      <div className="flex gap-2">
        <Button onClick={submit} disabled={add.isPending}>
          {add.isPending ? 'Saving…' : 'Add to the log'}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
