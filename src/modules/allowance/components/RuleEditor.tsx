/**
 * Overriding a seeded stay rule.
 *
 * `useUpsertRule` has existed since Phase 9 with no form, so the seeded
 * defaults were the only rules there could ever be — and they are a
 * deliberately conservative common-case set. Anybody whose situation differs
 * from the common case (a residence permit, a long-stay visa, a nationality
 * the seed does not cover) had a screen telling them a number that was wrong
 * for them, with no way to correct it.
 *
 * ## Why an override rather than an edit
 *
 * The seeded rows have `couple_id` null and are shared reference data. Editing
 * one in place would change it for a hypothetical other couple and, more to the
 * point, would destroy the source link and checked-on date that make the
 * original auditable. So this writes a *new* row scoped to the person, and
 * `ruleFor` already prefers a personal rule over a seeded one.
 *
 * ## Why it asks for a source
 *
 * Not required — somebody's own residence permit is not on a public URL. But
 * the field is there and labelled, because a rule with no source is exactly the
 * kind of thing that is right when entered and unverifiable a year later. The
 * staleness marker (D106) reads the same `verified_on` on an override as on a
 * seeded row.
 */
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { ErrorState } from '@/components/common/states'
import { todayIn } from '@/lib/dates'
import { useCouple } from '@/providers/CoupleProvider'
import { useUpsertRule } from '../hooks'
import type { AllowanceRule } from '../types'

const RULE_TYPES: { value: string; label: string; hint: string }[] = [
  { value: 'rolling', label: 'Rolling window', hint: 'Like Schengen: N days in any M.' },
  { value: 'per_entry', label: 'Per entry', hint: 'A fresh allowance each time you arrive.' },
  { value: 'per_year', label: 'Per calendar year', hint: 'Resets on 1 January.' },
  { value: 'per_visa', label: 'Per visa', hint: 'Counted against the visa, not the calendar.' },
  { value: 'none', label: 'No limit', hint: 'A residence permit or citizenship. Tracked, uncapped.' },
]

export function RuleEditor({
  passportCountry,
  destinationCountry,
  existing,
  onDone,
}: {
  passportCountry: string
  destinationCountry: string
  /** The rule being overridden, seeded or personal. Prefills the form. */
  existing: AllowanceRule | null
  onDone: () => void
}) {
  const { tzSelf } = useCouple()
  const upsert = useUpsertRule()

  const [ruleType, setRuleType] = useState(existing?.rule_type ?? 'rolling')
  const [maxDays, setMaxDays] = useState(String(existing?.max_days ?? 90))
  const [windowDays, setWindowDays] = useState(String(existing?.window_days ?? 180))
  const [label, setLabel] = useState(existing?.label ?? '')
  const [sourceUrl, setSourceUrl] = useState(existing?.source_url ?? '')
  const [notes, setNotes] = useState(existing?.notes ?? '')

  const needsWindow = ruleType === 'rolling'
  const uncapped = ruleType === 'none'
  // The database refuses a rolling rule with no window. Saying so here is the
  // difference between a hint and a round trip that fails.
  const valid =
    uncapped ||
    (Number(maxDays) > 0 && (!needsWindow || Number(windowDays) > 0))

  return (
    <form
      className="space-y-3 rounded-lg border border-border p-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (!valid) return
        upsert.mutate(
          {
            passport_country: passportCountry.toUpperCase(),
            destination_country: destinationCountry.toUpperCase(),
            rule_type: ruleType,
            // 'none' still needs a number for the column; zero is the honest
            // one, and nothing renders it because `rule_type` short-circuits.
            max_days: uncapped ? 0 : Number(maxDays),
            window_days: needsWindow ? Number(windowDays) : null,
            label: label.trim() || null,
            source_url: sourceUrl.trim() || null,
            notes: notes.trim() || null,
            // Entered today, by the person it applies to. That is what the
            // date means on an override, and the staleness marker treats it
            // exactly like a seeded one.
            verified_on: todayIn(tzSelf),
            region_members: existing?.region_members ?? null,
          },
          { onSuccess: onDone },
        )
      }}
    >
      <p className="text-sm font-medium">
        Your own rule for {passportCountry} → {destinationCountry}
      </p>
      <p className="text-xs text-muted-foreground">
        This replaces the default for you only. Your partner keeps theirs, and the original stays
        on file with its source.
      </p>

      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground">How it is counted</span>
        <Select value={ruleType} onChange={(e) => setRuleType(e.target.value)}>
          {RULE_TYPES.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </Select>
        <span className="text-xs text-muted-foreground">
          {RULE_TYPES.find((t) => t.value === ruleType)?.hint}
        </span>
      </label>

      {!uncapped && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Days allowed</span>
            <Input
              inputMode="numeric"
              value={maxDays}
              onChange={(e) => setMaxDays(e.target.value)}
            />
          </label>
          {needsWindow && (
            <label className="block space-y-1">
              <span className="text-xs text-muted-foreground">In any (days)</span>
              <Input
                inputMode="numeric"
                value={windowDays}
                onChange={(e) => setWindowDays(e.target.value)}
              />
            </label>
          )}
        </div>
      )}

      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground">What it is called</span>
        <Input
          value={label}
          placeholder="Residence permit"
          onChange={(e) => setLabel(e.target.value)}
        />
      </label>

      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground">
          Where it says so — optional, and worth filling in
        </span>
        <Input
          type="url"
          value={sourceUrl}
          placeholder="https://…"
          onChange={(e) => setSourceUrl(e.target.value)}
        />
      </label>

      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground">Notes</span>
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>

      {upsert.error ? <ErrorState error={upsert.error} title="That did not save" /> : null}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!valid || upsert.isPending}>
          {upsert.isPending ? 'Saving…' : 'Save my rule'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
