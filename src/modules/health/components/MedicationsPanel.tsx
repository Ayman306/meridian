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

import { useId, useState } from 'react'
import { ExternalLink, Pencil, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { EmptyState, ErrorState, SkeletonList } from '@/components/common/states'
import { cn } from '@/lib/utils'
import { useDocuments } from '@/modules/documents'
import { formatDateOnly, todayIn } from '@/lib/dates'
import { freshness } from '@/lib/advisory'
import { useCouple } from '@/providers/CoupleProvider'
import { NOT_CHECKED, checkSupply, describeSupply, matchRestrictions, restrictionNotice } from '../logic'
import {
  useAddRecord,
  useDeleteRecord,
  useHealthRecords,
  useRestrictions,
  useUpdateRecord,
} from '../hooks'
import type { HealthRecord, RecordKind } from '../types'

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
  // Only this person's own documents — see the note beside the picker.
  const documents = useDocuments()
  const myDocuments = (documents.data ?? []).filter((doc) => doc.owner_id === ownerId)
  const remove = useDeleteRecord()

  const [kind, setKind] = useState<RecordKind>('medication')
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)

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
          <RecordForm
            kind={kind}
            documents={myDocuments}
            onDone={() => setAdding(false)}
          />
        ) : (
          <Button
            variant="outline"
            onClick={() => {
              setEditing(null)
              setAdding(true)
            }}
          >
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
          {shown.map((row) =>
            editing === row.id ? (
              <li key={row.id} className="p-3">
                <RecordForm
                  kind={kind}
                  record={row}
                  documents={myDocuments}
                  onDone={() => setEditing(null)}
                />
              </li>
            ) : (
              <li key={row.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{row.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {[row.dosage, row.frequency].filter(Boolean).join(' · ')}
                    {row.valid_until && ` · valid to ${row.valid_until}`}
                  </p>
                </div>
                {!readOnly && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit ${row.label}`}
                      onClick={() => {
                        setAdding(false)
                        setEditing(row.id)
                      }}
                    >
                      <Pencil className="size-4" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${row.label}`}
                      onClick={() => remove.mutate(row.id)}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  </>
                )}
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  )
}

/**
 * One record, new or existing.
 *
 * Extracted from the panel when editing arrived: the add form and the edit
 * form differ only in where the initial values come from and which mutation
 * runs, and keeping one of them inline would have meant maintaining the dosage
 * fields and the document picker twice.
 *
 * Editing matters most for the numbers. `quantity_remaining` is the one field
 * here that is wrong the day after you enter it — it goes down every time a
 * dose is taken — and `checkSupply` reads it to decide whether a trip runs you
 * short. A supply warning computed from a count nobody could correct is worse
 * than no warning.
 */
function RecordForm({
  kind,
  record,
  documents,
  onDone,
}: {
  kind: RecordKind
  record?: HealthRecord | null
  documents: { id: string; label: string }[]
  onDone: () => void
}) {
  const add = useAddRecord()
  const update = useUpdateRecord()
  // The add form and an open editor can be on the page together, and a
  // duplicated `id` binds both labels to whichever input rendered first.
  const uid = useId()

  const [label, setLabel] = useState(record?.label ?? '')
  const [dosage, setDosage] = useState(record?.dosage ?? '')
  const [perDay, setPerDay] = useState(
    record?.doses_per_day === null || record?.doses_per_day === undefined
      ? ''
      : String(record.doses_per_day),
  )
  const [remaining, setRemaining] = useState(
    record?.quantity_remaining === null || record?.quantity_remaining === undefined
      ? ''
      : String(record.quantity_remaining),
  )
  const [documentId, setDocumentId] = useState(record?.document_id ?? '')

  // An existing record keeps its own kind; a new one takes the open tab's.
  const recordKind = record?.kind ?? kind
  const pending = add.isPending || update.isPending
  const error = add.error ?? update.error

  const save = () => {
    const payload = {
      kind: recordKind,
      label: label.trim(),
      dosage: dosage.trim() || null,
      doses_per_day: perDay ? Number(perDay) : null,
      quantity_remaining: remaining ? Number(remaining) : null,
      document_id: documentId || null,
    }
    if (record) update.mutate({ id: record.id, patch: payload }, { onSuccess: onDone })
    else add.mutate(payload, { onSuccess: onDone })
  }

  return (
    <Card className="space-y-3 p-5">
      <div className="space-y-1">
        <label htmlFor={`record-label-${uid}`} className="text-sm">
          Name
        </label>
        <Input
          id={`record-label-${uid}`}
          autoFocus
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
      </div>

      {recordKind === 'medication' && (
        <>
          <div className="space-y-1">
            <label htmlFor={`record-dosage-${uid}`} className="text-sm">
              Dosage
            </label>
            <Input
              id={`record-dosage-${uid}`}
              placeholder="50mg"
              value={dosage}
              onChange={(e) => setDosage(e.target.value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor={`record-per-day-${uid}`} className="text-sm">
                Doses a day
              </label>
              <Input
                id={`record-per-day-${uid}`}
                inputMode="decimal"
                value={perDay}
                onChange={(e) => setPerDay(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor={`record-remaining-${uid}`} className="text-sm">
                How many left
              </label>
              <Input
                id={`record-remaining-${uid}`}
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

      {/* The certificate itself. `document_id` has been on the row since
          Phase 14 with no picker, so a yellow fever card could sit in the
          vault and the vaccination record beside it could not point at
          it — which is the one moment you need both: at a border.

          Only the owner's own documents are offered. A vaccination record
          is owner-private, and letting it reference the partner's
          paperwork would leak which documents they hold. */}
      {(recordKind === 'vaccination' || recordKind === 'medication') && documents.length > 0 && (
        <div className="space-y-1">
          <label htmlFor={`record-document-${uid}`} className="text-sm">
            {recordKind === 'vaccination' ? 'Certificate' : 'Prescription'} in the vault
          </label>
          <select
            id={`record-document-${uid}`}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={documentId}
            onChange={(e) => setDocumentId(e.target.value)}
          >
            <option value="">Not linked</option>
            {documents.map((doc) => (
              <option key={doc.id} value={doc.id}>
                {doc.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex gap-2">
        <Button disabled={!label.trim() || pending} onClick={save}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
      {error ? <ErrorState error={error} title="That did not save" /> : null}
    </Card>
  )
}
