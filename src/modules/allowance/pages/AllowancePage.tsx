/**
 * Status per person per country, and the log it is computed from.
 *
 * The screen's whole job is to be trustworthy about something with real
 * consequences, so it says three things everywhere: what it counted, where the
 * rule came from, and that it is advisory.
 */
'use client'

import { useMemo, useState } from 'react'
import { CalendarPlus, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/layout/PageHeader'
import { PersonBadge } from '@/components/PersonBadge'
import { EmptyState, ErrorState, SkeletonList } from '@/components/common/states'
import { formatInZone, parseDateOnly, todayIn } from '@/lib/dates'
import { pluralise } from '@/lib/utils'
import { displayCountry } from '@/lib/zones'
import { useCouple } from '@/providers/CoupleProvider'
import { AdvisoryNote } from '../components/AdvisoryNote'
import { RuleEditor } from '../components/RuleEditor'
import { AllowanceBar } from '../components/AllowanceBar'
import { LogEditor } from '../components/LogEditor'
import {
  useAllowanceRules,
  useAllowanceRealtime,
  useDeleteLogEntry,
  useEntryLog,
  useLogEntry,
  useLogSuggestions,
} from '../hooks'
import {
  ALLOWANCE_DISCLAIMER,
  describeRule,
  findOverlaps,
  ruleFor,
  statusFor,
} from '../logic'
import type { AllowanceRule, EntryExitLog } from '../types'

export function AllowancePage() {
  const { self, partner, selfRef, partnerRef, tzSelf } = useCouple()
  const rules = useAllowanceRules()
  useAllowanceRealtime()
  const log = useEntryLog()
  const suggestions = useLogSuggestions()
  const addEntry = useLogEntry()
  const removeEntry = useDeleteLogEntry()
  const [adding, setAdding] = useState(false)

  const today = todayIn(tzSelf)
  const entries = useMemo(() => log.data ?? [], [log.data])

  /**
   * One card per person per country they have actually been to. Countries with
   * no rule still appear — "not tracked" is information, and a country
   * silently missing from this page would look like a country with no limit.
   */
  const cards = useMemo(() => {
    const out: {
      person: typeof self
      countryCode: string
      rule: AllowanceRule | null
      /** Which of their passports the rule was matched on, for an override. */
      passportCountry: string
      entries: EntryExitLog[]
    }[] = []

    for (const person of [self, partner]) {
      if (!person) continue
      const theirs = entries.filter((e) => e.user_id === person.id)
      const countries = [...new Set(theirs.map((e) => e.country_code.toUpperCase()))].sort()

      for (const countryCode of countries) {
        const matched = ruleFor(rules.data ?? [], person.id, countryCode, [
          person.nationality,
          person.second_nationality,
        ])

        out.push({
          person,
          countryCode,
          rule: matched,
          // The rule's own passport when there is one, so an override replaces
          // exactly what was matched. Otherwise their primary nationality —
          // adding a rule for a passport they do not hold would never match.
          passportCountry: matched?.passport_country ?? person.nationality ?? '',
          entries: theirs.filter((e) => e.country_code.toUpperCase() === countryCode),
        })
      }
    }

    return out
  }, [entries, rules.data, self, partner])

  const overlaps = useMemo(() => findOverlaps(entries, today), [entries, today])
  const refFor = (userId: string) => (userId === selfRef?.id ? selfRef : partnerRef)

  return (
    <div>
      <PageHeader
        title="Stay allowance"
        description="How long each of you may stay, counted from the crossings you log."
        actions={
          !adding && (
            <Button onClick={() => setAdding(true)}>
              <Plus aria-hidden="true" />
              Log a crossing
            </Button>
          )
        }
      />

      <AdvisoryNote text={ALLOWANCE_DISCLAIMER} className="mb-6" />

      {adding && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Log a crossing</CardTitle>
          </CardHeader>
          <CardContent>
            <LogEditor onClose={() => setAdding(false)} />
          </CardContent>
        </Card>
      )}

      {suggestions.length > 0 && (
        <Card className="mb-6 border-accent/40 bg-accent/5">
          <CardContent className="space-y-3 py-5">
            <p className="flex items-center gap-2 text-sm font-medium">
              <CalendarPlus className="size-4 text-accent" aria-hidden="true" />
              From your trips
            </p>
            {suggestions.map((s) => (
              <div
                key={`${s.userId}-${s.tripId}-${s.countryCode}`}
                className="flex flex-wrap items-center gap-3 text-sm"
              >
                <PersonBadge person={refFor(s.userId)} size="xs" />
                <span className="mr-auto">
                  {s.countryCode}, {formatInZone(parseDateOnly(s.enteredOn), 'UTC', 'd MMM yyyy')} –{' '}
                  {formatInZone(parseDateOnly(s.exitedOn), 'UTC', 'd MMM yyyy')}
                  <span className="ml-2 text-xs text-muted-foreground">{s.tripTitle}</span>
                </span>
                {/* Only your own — the log row records who crossed a border,
                    and that is not a claim anyone should make for someone else. */}
                {s.userId === selfRef?.id ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={addEntry.isPending}
                    onClick={() =>
                      addEntry.mutate({
                        countryCode: s.countryCode,
                        enteredOn: s.enteredOn,
                        exitedOn: s.exitedOn,
                        tripId: s.tripId,
                        isEstimated: true,
                      })
                    }
                  >
                    Add to my log
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">Theirs to add</span>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {overlaps.length > 0 && (
        <Card className="mb-6 border-[hsl(var(--warn))]/40">
          <CardContent className="py-4 text-sm">
            <p className="flex items-center gap-2 font-medium">
              <TriangleAlert className="size-4 text-[hsl(var(--warn))]" aria-hidden="true" />
              {pluralise(overlaps.length, 'overlapping entry', 'overlapping entries')}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Two rows cover the same days. The count merges them rather than counting twice, but
              it is usually a typo worth fixing.
            </p>
          </CardContent>
        </Card>
      )}

      {log.isLoading || rules.isLoading ? (
        <SkeletonList rows={3} />
      ) : log.error ? (
        <ErrorState error={log.error} onRetry={() => void log.refetch()} />
      ) : entries.length === 0 ? (
        <EmptyState
          title="Nothing logged yet"
          description="Add the trips you have already taken and this works out what each of you has left. Nothing here is shared outside the two of you."
          action={<Button onClick={() => setAdding(true)}>Log the first crossing</Button>}
        />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            {cards.map((card) => (
              <StatusCard
                key={`${card.person!.id}-${card.countryCode}`}
                personRef={refFor(card.person!.id)}
                countryCode={card.countryCode}
                rule={card.rule}
                passportCountry={card.passportCountry}
                entries={card.entries}
                today={today}
              />
            ))}
          </div>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold">The log</h2>
            <div className="space-y-2">
              {entries.map((entry) => (
                <div
                  key={entry.id}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3 text-sm"
                >
                  <PersonBadge person={refFor(entry.user_id)} size="xs" />
                  <span className="font-medium">{entry.country_code}</span>
                  <span className="text-muted-foreground">
                    {formatInZone(parseDateOnly(entry.entered_on), 'UTC', 'd MMM yyyy')} –{' '}
                    {entry.exited_on
                      ? formatInZone(parseDateOnly(entry.exited_on), 'UTC', 'd MMM yyyy')
                      : 'still there'}
                  </span>
                  {entry.is_estimated && (
                    <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                      Estimated
                    </span>
                  )}
                  {entry.user_id === selfRef?.id && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="ml-auto size-8"
                      onClick={() => removeEntry.mutate(entry.id)}
                    >
                      <Trash2 aria-hidden="true" />
                      <span className="sr-only">Remove this crossing</span>
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

function StatusCard({
  personRef,
  countryCode,
  rule,
  passportCountry,
  entries,
  today,
}: {
  personRef: ReturnType<typeof useCouple>['selfRef']
  countryCode: string
  rule: AllowanceRule | null
  passportCountry: string
  entries: EntryExitLog[]
  today: string
}) {
  const status = rule ? statusFor(entries, rule, today) : null
  const [editing, setEditing] = useState(false)

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <PersonBadge person={personRef} size="xs" />
          {rule ? displayCountry(rule.destination_country) : countryCode}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!rule ? (
          <p className="text-sm text-muted-foreground">
            Not tracked — no stay rule on file for this passport and country. That is not the same
            as no limit.
          </p>
        ) : rule.rule_type === 'none' ? (
          <p className="text-sm text-muted-foreground">No limit on this status.</p>
        ) : (
          <>
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-semibold tabular">
                {status!.used}
                <span className="text-base font-normal text-muted-foreground"> / {rule.max_days}</span>
              </span>
              <span className="text-sm text-muted-foreground">
                {pluralise(status!.remaining, 'day')} left
              </span>
            </div>

            <AllowanceBar used={status!.used} limit={rule.max_days} />

            <p className="text-xs text-muted-foreground">
              {describeRule(rule)}
              {status!.windowStart && (
                <>
                  {' · '}counting from{' '}
                  {formatInZone(parseDateOnly(status!.windowStart), 'UTC', 'd MMM yyyy')}
                </>
              )}
            </p>

            {status!.isPresent && (
              <p className="text-sm">
                {status!.mustLeaveBy ? (
                  <>
                    Currently there — last permissible day is{' '}
                    <strong>
                      {formatInZone(parseDateOnly(status!.mustLeaveBy), 'UTC', 'd MMM yyyy')}
                    </strong>
                    .
                  </>
                ) : status!.remaining === 0 ? (
                  <span className="text-destructive">
                    Currently there, and already at the limit.
                  </span>
                ) : (
                  'Currently there.'
                )}
              </p>
            )}
          </>
        )}

        {rule && (
          <AdvisoryNote
            text={ALLOWANCE_DISCLAIMER}
            sourceUrl={rule.source_url}
            verifiedOn={rule.verified_on}
          />
        )}

        {/* The seeded rules are a conservative common-case set. Anybody whose
            situation differs — a residence permit, a long-stay visa, a
            nationality the seed does not cover — was being shown a number that
            was wrong for them with no way to correct it. */}
        {editing ? (
          <RuleEditor
            passportCountry={passportCountry}
            destinationCountry={rule?.destination_country ?? countryCode}
            existing={rule}
            onDone={() => setEditing(false)}
          />
        ) : (
          <button
            type="button"
            className="self-start text-xs text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => setEditing(true)}
          >
            {rule ? 'This is wrong for me — set my own rule' : 'Add a rule for this country'}
          </button>
        )}
      </CardContent>
    </Card>
  )
}
