/**
 * Medications, vaccinations, conditions and allergies — plus the two things
 * they are actually for on a trip: does the supply last, and is any of it
 * restricted where you are going.
 *
 * The restriction block is the most carefully worded thing in the app. It
 * matches a name, states that restrictions exist in that country, and links to
 * the official page. It never says whether something may be carried, because
 * that is a regulated claim and this app is not the authority. Where there is
 * no data it says the check was not done — never that anything is safe.
 */
'use client'

import { useState } from 'react'
import { ExternalLink, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { EmptyState, ErrorState, SkeletonList } from '@/components/common/states'
import { cn } from '@/lib/utils'
import { formatDateOnly, todayIn } from '@/lib/dates'
import { freshness } from '@/lib/advisory'
import { useCouple } from '@/providers/CoupleProvider'
import { NOT_CHECKED, checkSupply, describeSupply, matchRestrictions, restrictionNotice } from '../logic'
import { useAddRecord, useDeleteRecord, useHealthRecords, useRestrictions } from '../hooks'
import type { RecordKind } from '../types'

const KINDS: { value: RecordKind; label: string }[] = [
  { value: 'medication', label: 'Medications' },
  { value: 'vaccination', label: 'Vaccinations' },
  { value: 'condition', label: 'Conditions' },
  { value: 'allergy', label: 'Allergies' },
]

export function MedicationsPanel({
  ownerId,
  readOnly = false,
  trip,
}: {
  ownerId: string
  readOnly?: boolean
  /** Set when viewed from a trip, so supply and restrictions can be checked. */
  trip?: { nights: number; countryCode: string | null; countryName: string } | null
}) {
  const { tzSelf } = useCouple()
  const today = todayIn(tzSelf)
  const records = useHealthRecords(ownerId)
  const restrictions = useRestrictions(trip?.countryCode ?? null)
  const add = useAddRecord()
  const remove = useDeleteRecord()

  const [kind, setKind] = useState<RecordKind>('medication')
  const [adding, setAdding] = useState(false)
  const [label, setLabel] = useState('')
  const [dosage, setDosage] = useState('')
  const [perDay, setPerDay] = useState('')
  const [remaining, setRemaining] = useState('')

  if (records.isLoading) return <SkeletonList rows={3} />
  if (records.error) return <ErrorState error={records.error} title="That did not load" />

  const all = records.data ?? []
  const shown = all.filter((r) => r.kind === kind)
  const matches = trip ? matchRestrictions(all, restrictions.data ?? []) : []

  return (
    <div className="space-y-4">
      {trip && (
        <Card className="space-y-3 p-5">
          <h3 className="text-sm font-medium">Taking these to {trip.countryName}</h3>

          {!trip.countryCode || restrictions.data === undefined ? (
            <p className="text-sm text-muted-foreground">{NOT_CHECKED}</p>
          ) : matches.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing on your list matched the restriction data for {trip.countryName}. That is not
              a clearance — rules change and this list is small. Check the official guidance if you
              are carrying anything prescribed.
            </p>
          ) : (
            <>
              <p className="flex items-start gap-2 text-sm">
                <TriangleAlert
                  className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-500"
                  aria-hidden="true"
                />
                {restrictionNotice(trip.countryName)}
              </p>
              <ul className="space-y-2">
                {matches.map(({ record, restriction }) => (
                  <li
                    key={`${record.id}-${restriction.id}`}
                    className="rounded-md border border-border p-3 text-sm"
                  >
                    <p className="font-medium">{record.label}</p>
                    <p className="text-xs text-muted-foreground">
                      Matched &ldquo;{restriction.substance}&rdquo;
                      {restriction.restriction && ` — ${restriction.restriction}`}
                    </p>
                    <a
                      href={restriction.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-flex items-center gap-1 text-xs underline underline-offset-2"
                    >
                      Official guidance
                      <ExternalLink className="size-3" aria-hidden="true" />
                    </a>
                    {restriction.verified_on && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        checked {formatDateOnly(restriction.verified_on, 'd MMM yyyy')}
                        {/* Customs rules on medication change quietly and the
                            consequence of an old one is being stopped at a
                            border, so an old check says so. */}
                        {freshness(restriction.verified_on, today)?.stale && (
                          <span className="text-[hsl(var(--warn))]"> — old, open the link</span>
                        )}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                This app is not the authority on any of this. The linked page is.
              </p>
            </>
          )}

          {/* Supply, for the medications that carry numbers. */}
          {all
            .filter((r) => r.kind === 'medication')
            .map((record) => describeSupply(checkSupply(record, trip.nights), record.label))
            .filter((line): line is string => line !== null)
            .map((line) => (
              <p key={line} className="text-sm text-muted-foreground">
                {line}
              </p>
            ))}
        </Card>
      )}

      <div className="flex gap-1 overflow-x-auto border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist">
        {KINDS.map((option) => (
          <button
            key={option.value}
            role="tab"
            aria-selected={kind === option.value}
            className={cn(
              '-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm',
              kind === option.value
                ? 'border-accent font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setKind(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {!readOnly &&
        (adding ? (
          <Card className="space-y-3 p-5">
            <div className="space-y-1">
              <label htmlFor="record-label" className="text-sm">
                Name
              </label>
              <Input
                id="record-label"
                autoFocus
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>

            {kind === 'medication' && (
              <>
                <div className="space-y-1">
                  <label htmlFor="record-dosage" className="text-sm">
                    Dosage
                  </label>
                  <Input
                    id="record-dosage"
                    placeholder="50mg"
                    value={dosage}
                    onChange={(e) => setDosage(e.target.value)}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <label htmlFor="record-per-day" className="text-sm">
                      Doses a day
                    </label>
                    <Input
                      id="record-per-day"
                      inputMode="decimal"
                      value={perDay}
                      onChange={(e) => setPerDay(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="record-remaining" className="text-sm">
                      How many left
                    </label>
                    <Input
                      id="record-remaining"
                      inputMode="decimal"
                      value={remaining}
                      onChange={(e) => setRemaining(e.target.value)}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Both optional. With them, the app can say whether a trip runs you short.
                </p>
              </>
            )}

            <div className="flex gap-2">
              <Button
                disabled={!label.trim() || add.isPending}
                onClick={() =>
                  add.mutate(
                    {
                      kind,
                      label: label.trim(),
                      dosage: dosage.trim() || null,
                      doses_per_day: perDay ? Number(perDay) : null,
                      quantity_remaining: remaining ? Number(remaining) : null,
                    },
                    {
                      onSuccess: () => {
                        setAdding(false)
                        setLabel('')
                        setDosage('')
                        setPerDay('')
                        setRemaining('')
                      },
                    },
                  )
                }
              >
                {add.isPending ? 'Saving…' : 'Save'}
              </Button>
              <Button variant="ghost" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
            {add.error ? <ErrorState error={add.error} title="That did not save" /> : null}
          </Card>
        ) : (
          <Button variant="outline" onClick={() => setAdding(true)}>
            <Plus aria-hidden="true" />
            Add
          </Button>
        ))}

      {shown.length === 0 ? (
        <EmptyState
          title="Nothing here"
          description={readOnly ? 'Nothing recorded, or nothing shared.' : undefined}
          subtle
        />
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {shown.map((row) => (
            <li key={row.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{row.label}</p>
                <p className="text-xs text-muted-foreground">
                  {[row.dosage, row.frequency].filter(Boolean).join(' · ')}
                  {row.valid_until && ` · valid to ${row.valid_until}`}
                </p>
              </div>
              {!readOnly && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete ${row.label}`}
                  onClick={() => remove.mutate(row.id)}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
