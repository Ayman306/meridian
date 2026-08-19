/**
 * The comparison board: candidates across, attributes down.
 *
 * A real table, not a grid of divs, because that is what it is — and because
 * the row header travelling with each cell is what makes it readable on a
 * phone, where the whole thing scrolls sideways.
 */
'use client'

import { useState } from 'react'
import { Check, Plane, Star, Trash2, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PersonBadge } from '@/components/PersonBadge'
import { AllowanceWarning } from '@/modules/allowance'
import { cn, pluralise } from '@/lib/utils'
import { formatInZone, parseDateOnly, todayIn } from '@/lib/dates'
import { freshness } from '@/lib/advisory'
import { useCouple } from '@/providers/CoupleProvider'
import type { PersonRef } from '@/types/domain'
import type { AllowanceCheck } from '@/modules/allowance'
import { BAND_LABELS } from '../climate'
import { COST_LABELS, costBand } from '../cost'
import { VISA_DISCLAIMER, VISA_TIER_LABELS } from '../logic'
import { FairnessBar } from './FairnessBar'
import type { BoardColumn, ScoreBreakdown, VisaTier } from '../types'

export function BoardTable({
  columns,
  people,
  allowanceFor,
  showScores,
  onChoose,
  onRemove,
}: {
  columns: BoardColumn[]
  people: PersonRef[]
  allowanceFor: (column: BoardColumn, personId: string) => AllowanceCheck | null
  showScores: boolean
  onChoose: (column: BoardColumn, chosen: boolean) => void
  onRemove: (column: BoardColumn) => void
}) {
  const [openScore, setOpenScore] = useState<string | null>(null)
  const { tzSelf } = useCouple()
  const today = todayIn(tzSelf)

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] border-collapse text-sm">
        <caption className="sr-only">Destination candidates compared</caption>
        <thead>
          <tr>
            <th scope="col" className="w-36 p-2 text-left align-bottom text-xs font-medium text-muted-foreground">
              Compared on
            </th>
            {columns.map((column) => (
              <th
                key={column.destination.id}
                scope="col"
                className={cn(
                  'min-w-44 border-b border-border p-3 text-left align-bottom',
                  column.destination.state === 'chosen' && 'bg-accent/5',
                  column.destination.state === 'rejected' && 'opacity-55',
                )}
              >
                <span className="flex items-center gap-1.5 text-base font-semibold">
                  {column.destination.state === 'chosen' && (
                    <Star className="size-3.5 fill-accent text-accent" aria-hidden="true" />
                  )}
                  {column.destination.city}
                </span>
                {column.destination.country_code && (
                  <span className="block text-xs font-normal text-muted-foreground">
                    {column.destination.country_code}
                  </span>
                )}
                {column.destination.state === 'rejected' && (
                  <span className="mt-1 block text-xs font-normal text-muted-foreground">
                    Ruled out — kept for the reasoning
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {people.map((person) => (
            <Row key={`flight-${person.id}`} label={<PersonLabel person={person} suffix="flies" />}>
              {columns.map((column) => {
                const view = column.people.find((p) => p.userId === person.id)
                if (!view?.flight) return <Cell key={column.destination.id}>—</Cell>
                return (
                  <Cell key={column.destination.id} column={column}>
                    <span className="flex items-center gap-1.5">
                      <Plane className="size-3.5 text-muted-foreground" aria-hidden="true" />
                      {view.flight.hours}h
                      {/* Spec 4.7: an estimate must not look like a timetable. */}
                      {view.flight.isEstimated && (
                        <span
                          className="rounded border border-dashed border-border px-1 text-[10px] text-muted-foreground"
                          title="Estimated from the distance — no cached route for this pair"
                        >
                          est
                        </span>
                      )}
                    </span>
                  </Cell>
                )
              })}
            </Row>
          ))}

          <Row label="Fair split">
            {columns.map((column) => (
              <Cell key={column.destination.id} column={column}>
                <FairnessCell column={column} people={people} />
              </Cell>
            ))}
          </Row>

          {people.map((person) => (
            <Row key={`visa-${person.id}`} label={<PersonLabel person={person} suffix="visa" />}>
              {columns.map((column) => {
                const view = column.people.find((p) => p.userId === person.id)
                return (
                  <Cell key={column.destination.id} column={column}>
                    {view?.isHome ? (
                      <span className="text-muted-foreground">Home</span>
                    ) : view?.visa ? (
                      <span className="space-y-0.5">
                        <span className="block">
                          {view.visa.label ?? VISA_TIER_LABELS[view.visa.tier as VisaTier]}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {view.passport} passport
                          {view.visa.max_days ? ` · up to ${view.visa.max_days} days` : ''}
                        </span>
                        <span className="block text-[11px] text-muted-foreground">
                          {view.visa.verified_on && (
                            <>
                              Checked{' '}
                              {formatInZone(parseDateOnly(view.visa.verified_on), 'UTC', 'd MMM yyyy')}
                              {/* A rule this old is still shown — it may well
                                  still be right. The reader just gets to know
                                  how much weight to put on it. */}
                              {freshness(view.visa.verified_on, today)?.stale && (
                                <span className="text-[hsl(var(--warn))]"> (old)</span>
                              )}
                              {' · '}
                            </>
                          )}
                          {view.visa.source_url && (
                            <a
                              href={view.visa.source_url}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="underline underline-offset-2"
                            >
                              Source
                            </a>
                          )}
                        </span>
                      </span>
                    ) : (
                      // Never "visa-free". A missing rule means we do not know.
                      <span className="text-[hsl(var(--warn))]">Unknown — check officially</span>
                    )}
                  </Cell>
                )
              })}
            </Row>
          ))}

          {people.map((person) => (
            <Row key={`allowance-${person.id}`} label={<PersonLabel person={person} suffix="can stay" />}>
              {columns.map((column) => {
                const check = allowanceFor(column, person.id)
                return (
                  <Cell key={column.destination.id} column={column}>
                    {check ? (
                      <AllowanceWarning check={check} person={person} compact />
                    ) : (
                      <span className="text-xs text-muted-foreground">Set trip dates</span>
                    )}
                  </Cell>
                )
              })}
            </Row>
          ))}

          <Row label="Season">
            {columns.map((column) => (
              <Cell key={column.destination.id} column={column}>
                {column.band ? (
                  BAND_LABELS[column.band]
                ) : (
                  <span className="text-xs text-muted-foreground">Set exact dates to compare</span>
                )}
              </Cell>
            ))}
          </Row>

          <Row label="Daily cost">
            {columns.map((column) => {
              const band = costBand(column.destination.country_code)
              return (
                <Cell key={column.destination.id} column={column}>
                  {band ? COST_LABELS[band] : <span className="text-muted-foreground">—</span>}
                </Cell>
              )
            })}
          </Row>

          <Row label="Saved places">
            {columns.map((column) => (
              <Cell key={column.destination.id} column={column}>
                {column.wishlistCount > 0 ? (
                  pluralise(column.wishlistCount, 'save')
                ) : (
                  <span className="text-muted-foreground">None yet</span>
                )}
              </Cell>
            ))}
          </Row>

          {showScores && (
            <Row label="Score">
              {columns.map((column) => (
                <Cell key={column.destination.id} column={column}>
                  {column.score ? (
                    <ScoreCell
                      score={column.score}
                      open={openScore === column.destination.id}
                      onToggle={() =>
                        setOpenScore(openScore === column.destination.id ? null : column.destination.id)
                      }
                    />
                  ) : (
                    '—'
                  )}
                </Cell>
              ))}
            </Row>
          )}

          <tr>
            <th scope="row" className="p-2 text-left align-top text-xs font-medium text-muted-foreground">
              &nbsp;
            </th>
            {columns.map((column) => (
              <td
                key={column.destination.id}
                className={cn(
                  'border-t border-border p-3 align-top',
                  column.destination.state === 'chosen' && 'bg-accent/5',
                )}
              >
                <div className="flex flex-wrap gap-1.5">
                  {column.destination.state === 'chosen' ? (
                    <Button variant="ghost" size="sm" onClick={() => onChoose(column, false)}>
                      <Undo2 aria-hidden="true" />
                      Unchoose
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={Boolean(column.excluded)}
                      title={column.excluded ?? undefined}
                      onClick={() => onChoose(column, true)}
                    >
                      <Check aria-hidden="true" />
                      Choose
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={() => onRemove(column)}
                  >
                    <Trash2 aria-hidden="true" />
                    <span className="sr-only">Remove {column.destination.city}</span>
                  </Button>
                </div>

                {column.excluded && (
                  <p className="mt-2 text-xs text-destructive">{column.excluded}</p>
                )}
              </td>
            ))}
          </tr>
        </tbody>
      </table>

      <p className="mt-3 text-xs text-muted-foreground">{VISA_DISCLAIMER}</p>
    </div>
  )
}

function Row({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <tr>
      <th
        scope="row"
        className="border-t border-border p-2 text-left align-top text-xs font-medium text-muted-foreground"
      >
        {label}
      </th>
      {children}
    </tr>
  )
}

function Cell({ column, children }: { column?: BoardColumn; children: React.ReactNode }) {
  return (
    <td
      className={cn(
        'border-t border-border p-3 align-top',
        column?.destination.state === 'chosen' && 'bg-accent/5',
        column?.destination.state === 'rejected' && 'opacity-55',
      )}
    >
      {children}
    </td>
  )
}

function PersonLabel({ person, suffix }: { person: PersonRef; suffix: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <PersonBadge person={person} size="xs" />
      {person.isSelf ? 'You' : person.displayName} {suffix}
    </span>
  )
}

function FairnessCell({ column, people }: { column: BoardColumn; people: PersonRef[] }) {
  const hours: Record<string, number | undefined> = {}
  for (const view of column.people) hours[view.userId] = view.flight?.hours
  return <FairnessBar fairness={column.fairness} people={people} hoursByPerson={hours} />
}

function ScoreCell({
  score,
  open,
  onToggle,
}: {
  score: ScoreBreakdown
  open: boolean
  onToggle: () => void
}) {
  return (
    <div className="space-y-1.5">
      {/* Spec 4.3: never a bare number. The breakdown is one tap away and the
          button says so. */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="tabular text-base font-semibold underline decoration-dotted underline-offset-4"
      >
        {Math.round(score.total * 100)}
      </button>
      {open && (
        <ul className="space-y-0.5 text-xs text-muted-foreground">
          {score.parts
            .filter((part) => part.weight > 0)
            .map((part) => (
              <li key={part.key} className="flex justify-between gap-2">
                <span>{part.key}</span>
                <span className="tabular">{Math.round(part.value * 100)}</span>
              </li>
            ))}
        </ul>
      )}
    </div>
  )
}
