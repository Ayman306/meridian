'use client'

import { cn } from '@/lib/utils'
import { PersonBadge } from '@/components/PersonBadge'
import type { PersonRef } from '@/types/domain'
import type { Fairness } from '../types'

const LABELS: Record<Fairness['kind'], string> = {
  balanced: 'Balanced',
  slight: 'Slightly uneven',
  skewed: 'Skewed',
  heavy: 'Heavily skewed',
}

/**
 * Who flies further, as a two-sided bar (spec 4.3).
 *
 * A number would answer the wrong question. "Six hours of difference" invites
 * arithmetic; a bar leaning towards one person's face makes the point in the
 * way the point is actually felt.
 */
export function FairnessBar({
  fairness,
  people,
  hoursByPerson,
}: {
  fairness: Fairness | null
  people: PersonRef[]
  hoursByPerson: Record<string, number | undefined>
}) {
  if (!fairness) return <span className="text-xs text-muted-foreground">—</span>

  const [a, b] = people
  const hoursA = a ? (hoursByPerson[a.id] ?? 0) : 0
  const hoursB = b ? (hoursByPerson[b.id] ?? 0) : 0
  const total = hoursA + hoursB
  const shareA = total > 0 ? (hoursA / total) * 100 : 50

  const tone =
    fairness.kind === 'balanced'
      ? 'text-[hsl(var(--ok))]'
      : fairness.kind === 'heavy'
        ? 'text-destructive'
        : 'text-muted-foreground'

  return (
    <div className="space-y-1.5">
      <div
        className="flex h-2 overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={
          fairness.towards
            ? `${LABELS[fairness.kind]} — ${fairness.diff} hours more for one of you`
            : LABELS[fairness.kind]
        }
      >
        <div className="bg-foreground/50" style={{ width: `${shareA}%` }} />
        <div className="flex-1 bg-foreground/25" />
      </div>

      <p className={cn('flex items-center gap-1.5 text-xs', tone)}>
        {LABELS[fairness.kind]}
        {fairness.diff > 0 && fairness.towards && (
          <>
            <span className="text-muted-foreground">· {fairness.diff}h more for</span>
            <PersonBadge person={people.find((p) => p.id === fairness.towards) ?? null} size="xs" />
          </>
        )}
      </p>
    </div>
  )
}
