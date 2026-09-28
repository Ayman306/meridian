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
 *
 * ## Tips of your own (0040)
 *
 * The two of you can add tips, and edit or remove the ones you added; the
 * seeded set is read-only. An assistant can only *propose* one — it lands
 * under "Waiting for you", outside the guidance itself, until one of you keeps
 * it (non-negotiable #5). The database enforces that, not this screen.
 */
'use client'

import { useState } from 'react'
import { Check, ExternalLink, Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { EmptyState, ErrorState, SkeletonList } from '@/components/common/states'
import { formatDateOnly, todayIn } from '@/lib/dates'
import { describeFreshness, freshness } from '@/lib/advisory'
import { AdvisoryNote } from '@/modules/allowance'
import { cn } from '@/lib/utils'
import { userMessage } from '@/lib/errors'
import { useCouple } from '@/providers/CoupleProvider'
import {
  TIP_CATEGORY_LABELS,
  describeTipOrigin,
  groupTips,
  isOwnTip,
  splitTips,
  visibleTips,
} from '../logic'
import { useKeepWellnessTip, useRemoveWellnessTip, useWellnessTips } from '../hooks'
import type { TipCategory, WellnessTip } from '../types'
import { WellnessTipForm } from './WellnessTipForm'

export function WellnessPanel() {
  const { self, tzSelf, coupleId, selfRef, partnerRef } = useCouple()
  const today = todayIn(tzSelf)
  const tips = useWellnessTips()
  const keep = useKeepWellnessTip()
  const remove = useRemoveWellnessTip()
  const [showAll, setShowAll] = useState(false)
  const [category, setCategory] = useState<TipCategory | null>(null)
  /** `'new'` for the add form, a tip for its edit form, null for neither. */
  const [editing, setEditing] = useState<WellnessTip | 'new' | null>(null)
  const [removing, setRemoving] = useState<WellnessTip | null>(null)

  if (tips.isLoading) return <SkeletonList rows={4} />
  if (tips.error) {
    return (
      <ErrorState
        error={tips.error}
        title="That did not load"
        onRetry={() => void tips.refetch()}
      />
    )
  }

  const people = {
    selfId: selfRef?.id ?? null,
    partnerId: partnerRef?.id ?? null,
    partnerName: partnerRef?.displayName ?? null,
  }
  const { published, drafts } = splitTips(tips.data ?? [])
  const visible = visibleTips(published, self, showAll)
  const groups = groupTips(visible).filter((g) => category === null || g.category === category)
  const busy = keep.isPending || remove.isPending
  const actionError = keep.error ?? remove.error

  return (
    <div className="space-y-4">
      {drafts.length > 0 && (
        <section className="space-y-2" aria-labelledby="wellness-drafts">
          <h3 id="wellness-drafts" className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="size-4 text-accent" aria-hidden="true" />
            Waiting for you
          </h3>
          <p className="text-xs text-muted-foreground">
            Suggested by an assistant. Nothing here is in your guidance until one of you keeps it.
          </p>
          {drafts.map((tip) => (
            <Card key={tip.id} className="space-y-2 border-accent/40 bg-accent/5 p-4">
              <p className="text-sm font-medium">{tip.title}</p>
              <p className="text-sm text-muted-foreground">{tip.body}</p>
              <p className="text-xs text-muted-foreground">
                {TIP_CATEGORY_LABELS[tip.category as TipCategory] ?? tip.category} ·{' '}
                <SourceLink href={tip.source_url} />
              </p>
              <div className="flex gap-2">
                <Button size="sm" disabled={busy} onClick={() => keep.mutate(tip.id)}>
                  <Check aria-hidden="true" />
                  Keep it
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => remove.mutate(tip.id)}
                >
                  <X aria-hidden="true" />
                  Discard
                </Button>
              </div>
            </Card>
          ))}
        </section>
      )}

      {actionError ? (
        <p className="text-sm text-destructive" role="alert">
          {userMessage(actionError)}
        </p>
      ) : null}

      {editing === 'new' && <WellnessTipForm onDone={() => setEditing(null)} />}

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

        {/* A couple's own tips belong to the couple, so there is nowhere to
            put one in solo mode. */}
        {coupleId && editing !== 'new' && (
          <Button size="sm" variant="outline" onClick={() => setEditing('new')}>
            <Plus aria-hidden="true" />
            Add a tip
          </Button>
        )}
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
                if (editing !== null && editing !== 'new' && editing.id === tip.id) {
                  return <WellnessTipForm key={tip.id} tip={tip} onDone={() => setEditing(null)} />
                }
                const origin = describeTipOrigin(tip, people)
                return (
                  <Card key={tip.id} className="space-y-1.5 p-4">
                    <p className="text-sm font-medium">{tip.title}</p>
                    <p className="text-sm text-muted-foreground">{tip.body}</p>
                    <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <SourceLink href={tip.source_url} />
                      {tip.verified_on && (
                        <span>
                          Written down {formatDateOnly(tip.verified_on, 'd MMM yyyy')}.
                          {/* A whole sentence, meant to follow a full stop — the
                              same shape AdvisoryNote gives it. */}
                          {staleness && (
                            <span className="text-[hsl(var(--warn))]"> {staleness}</span>
                          )}
                        </span>
                      )}
                      {origin && <span>{origin}.</span>}
                    </p>
                    {isOwnTip(tip) && (
                      <div className="flex gap-1 pt-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => setEditing(tip)}
                          aria-label={`Edit “${tip.title}”`}
                        >
                          <Pencil aria-hidden="true" />
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => setRemoving(tip)}
                          aria-label={`Remove “${tip.title}”`}
                        >
                          <Trash2 aria-hidden="true" />
                          Remove
                        </Button>
                      </div>
                    )}
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

      <ConfirmDialog
        open={removing !== null}
        title="Remove this tip?"
        description={removing ? `“${removing.title}” will no longer show for either of you.` : undefined}
        confirmLabel="Remove"
        destructive
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) remove.mutate(removing.id)
          setRemoving(null)
        }}
      />
    </div>
  )
}

function SourceLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 underline underline-offset-2"
    >
      Read the source
      <ExternalLink className="size-3" aria-hidden="true" />
    </a>
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
