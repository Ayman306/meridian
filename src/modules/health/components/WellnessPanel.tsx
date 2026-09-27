/**
 * Sexual wellness guidance. Extends Module 12.
 *
 * Every row is a pointer to guidance somebody else maintains — NHS, CDC — with
 * its source link and the date it was written down, exactly as the medication
 * restrictions are. **The app is not the authority. The linked page is.**
 *
 * ## Two rules this screen keeps
 *
 * **Nothing here is a target.** None of it tells anybody what they should
 * want, how often, or that their own answer is wrong. It is the same register
 * as the rest of the health module: information, and the source it came from.
 *
 * **The gender default is a first sort, not a gate.** `profiles.gender` picks
 * which set opens, the way it picks whether the cycle calendar appears
 * (0017) — and "Show everything" is one click away, always, for anybody.
 * Health information that hides itself based on a profile field is worse than
 * information that starts somewhere sensible and gets out of the way.
 */
'use client'

import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { EmptyState, ErrorState, SkeletonList } from '@/components/common/states'
import { formatDateOnly, todayIn } from '@/lib/dates'
import { describeFreshness, freshness } from '@/lib/advisory'
import { AdvisoryNote } from '@/modules/allowance'
import { cn } from '@/lib/utils'
import { useCouple } from '@/providers/CoupleProvider'
import { TIP_CATEGORY_LABELS, groupTips, visibleTips } from '../logic'
import { useWellnessTips } from '../hooks'
import type { TipCategory } from '../types'

export function WellnessPanel() {
  const { self, tzSelf } = useCouple()
  const today = todayIn(tzSelf)
  const tips = useWellnessTips()
  const [showAll, setShowAll] = useState(false)
  const [category, setCategory] = useState<TipCategory | null>(null)

  if (tips.isLoading) return <SkeletonList rows={4} />
  if (tips.error) return <ErrorState error={tips.error} title="That did not load" />

  const visible = visibleTips(tips.data ?? [], self, showAll)
  const groups = groupTips(visible).filter((g) => category === null || g.category === category)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-pressed={category === null}
          className={chip(category === null)}
          onClick={() => setCategory(null)}
        >
          Everything
        </button>
        {groupTips(visible).map((group) => (
          <button
            key={group.category}
            type="button"
            aria-pressed={category === group.category}
            className={chip(category === group.category)}
            onClick={() => setCategory(group.category)}
          >
            {TIP_CATEGORY_LABELS[group.category]}
          </button>
        ))}

        <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            className="size-4"
            checked={showAll}
            onChange={(e) => setShowAll(e.target.checked)}
          />
          Show everything, not just mine
        </label>
      </div>

      {groups.length === 0 ? (
        <EmptyState title="Nothing here yet" subtle />
      ) : (
        groups.map((group) => (
          <section key={group.category} className="space-y-2">
            <h3 className="text-sm font-semibold">{TIP_CATEGORY_LABELS[group.category]}</h3>
            <div className="space-y-2">
              {group.tips.map((tip) => {
                // The same wording the visa rules and stay allowances use, from
                // the one function that owns it — not a third phrasing of "old".
                const staleness = describeFreshness(freshness(tip.verified_on, today))
                return (
                  <Card key={tip.id} className="space-y-1.5 p-4">
                    <p className="text-sm font-medium">{tip.title}</p>
                    <p className="text-sm text-muted-foreground">{tip.body}</p>
                    <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <a
                        href={tip.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 underline underline-offset-2"
                      >
                        Read the source
                        <ExternalLink className="size-3" aria-hidden="true" />
                      </a>
                      {tip.verified_on && (
                        <span>
                          written down {formatDateOnly(tip.verified_on, 'd MMM yyyy')}
                          {staleness && (
                            <span className="text-[hsl(var(--warn))]"> — {staleness}</span>
                          )}
                        </span>
                      )}
                    </p>
                  </Card>
                )
              })}
            </div>
          </section>
        ))
      )}

      {/* The app's one disclaimer component, so this line cannot quietly go
          missing from one screen after a refactor. */}
      <AdvisoryNote text="General information, not medical advice, and none of it is a target. The linked page is the authority — and anything painful, persistent or worrying is a GP appointment rather than a reading list." />
    </div>
  )
}

function chip(active: boolean): string {
  return cn(
    'rounded-full border px-3 py-1 text-xs transition-colors',
    active
      ? 'border-accent bg-accent/10 font-medium'
      : 'border-border text-muted-foreground hover:text-foreground',
  )
}
