/**
 * The inline warning on a trip or a destination candidate (spec 10.2).
 *
 * It shows the exact date the limit would be hit, because "you might overstay"
 * is not actionable and "you would be over on 4 August" is. It warns and never
 * blocks: people have visas, exemptions and reasons the app does not know
 * about, and an app that refuses to let someone plan a trip it misunderstands
 * is worse than one that says what it thinks.
 */
'use client'

import { AlertTriangle, CheckCircle2, HelpCircle } from 'lucide-react'
import { formatInZone, parseDateOnly } from '@/lib/dates'
import { cn, pluralise } from '@/lib/utils'
import type { PersonRef } from '@/types/domain'
import { ALLOWANCE_DISCLAIMER, describeRule } from '../logic'
import { AdvisoryNote } from './AdvisoryNote'
import type { AllowanceCheck } from '../types'

export function AllowanceWarning({
  check,
  person,
  compact = false,
}: {
  check: AllowanceCheck
  person: PersonRef | null
  compact?: boolean
}) {
  const who = person?.isSelf ? 'You' : (person?.displayName ?? 'They')
  const verb = person?.isSelf ? 'you' : 'they'

  if (check.verdict === 'untracked') {
    if (compact) return <span className="text-xs text-muted-foreground">Not tracked</span>
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <HelpCircle className="size-4" aria-hidden="true" />
        No stay rule on file for {who.toLowerCase() === 'you' ? 'you' : who} here — not tracked.
      </p>
    )
  }

  if (check.rule?.rule_type === 'none') {
    if (compact) return <span className="text-xs text-muted-foreground">No limit</span>
    return null
  }

  const date = (value: string | null) =>
    value ? formatInZone(parseDateOnly(value), 'UTC', 'd MMM yyyy') : null

  if (compact) {
    return (
      <span
        className={cn(
          'text-xs',
          check.verdict === 'breach'
            ? 'font-medium text-destructive'
            : check.verdict === 'tight'
              ? 'text-[hsl(var(--warn))]'
              : 'text-muted-foreground',
        )}
      >
        {check.verdict === 'breach'
          ? `Over on ${date(check.breachDate)}`
          : `${pluralise(Math.max(0, check.headroom), 'day')} spare`}
      </span>
    )
  }

  const Icon = check.verdict === 'ok' ? CheckCircle2 : AlertTriangle

  return (
    <div
      className={cn(
        'space-y-2 rounded-lg border p-3',
        check.verdict === 'breach'
          ? 'border-destructive/40 bg-destructive/5'
          : check.verdict === 'tight'
            ? 'border-[hsl(var(--warn))]/40 bg-[hsl(var(--warn))]/5'
            : 'border-border',
      )}
    >
      <p className="flex items-start gap-2 text-sm">
        <Icon
          className={cn(
            'mt-0.5 size-4 shrink-0',
            check.verdict === 'breach'
              ? 'text-destructive'
              : check.verdict === 'tight'
                ? 'text-[hsl(var(--warn))]'
                : 'text-[hsl(var(--ok))]',
          )}
          aria-hidden="true"
        />
        <span>
          {check.verdict === 'breach' ? (
            <>
              <strong>{who}</strong> would be over the limit on{' '}
              <strong>{date(check.breachDate)}</strong> — {check.peak} days counted against{' '}
              {check.limit}.
            </>
          ) : check.verdict === 'tight' ? (
            <>
              <strong>{who}</strong> would be close: {check.peak} of {check.limit} days
              {check.peakDate ? ` by ${date(check.peakDate)}` : ''}, leaving{' '}
              {pluralise(Math.max(0, check.headroom), 'day')} spare.
            </>
          ) : (
            <>
              This fits {verb === 'you' ? 'your' : 'their'} allowance — {check.peak} of{' '}
              {check.limit} days at the peak, {pluralise(Math.max(0, check.headroom), 'day')} spare.
            </>
          )}
        </span>
      </p>

      {check.rule && (
        <AdvisoryNote
          text={`${describeRule(check.rule)}. ${ALLOWANCE_DISCLAIMER}`}
          sourceUrl={check.rule.source_url}
          verifiedOn={check.rule.verified_on}
        />
      )}
    </div>
  )
}
