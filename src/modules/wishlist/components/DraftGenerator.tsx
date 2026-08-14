/**
 * The draft generator's controls.
 *
 * A button, never automatic (spec 7.3), and its output goes to the tray rather
 * than the plan. The modifiers are the "regenerate with" row: slower, faster,
 * more food, skip museums.
 */
'use client'

import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { userMessage } from '@/lib/errors'
import { cn, pluralise } from '@/lib/utils'
import type { DateOnly } from '@/lib/dates'
import type { Draft, DraftOptions, Pace, WishlistItemWithVerdicts } from '../types'
import { generateDraft } from '../logic'
import { useSaveDraft } from '../hooks'

const PACES: { value: Pace; label: string }[] = [
  { value: 'relaxed', label: 'Relaxed' },
  { value: 'normal', label: 'Normal' },
  { value: 'packed', label: 'Packed' },
]

export function DraftGenerator({
  tripId,
  items,
  days,
  selfId,
  partnerId,
}: {
  tripId: string
  items: WishlistItemWithVerdicts[]
  days: DateOnly[]
  selfId: string
  partnerId: string | null
}) {
  const save = useSaveDraft(tripId)
  const [options, setOptions] = useState<DraftOptions>({ pace: 'normal' })
  const [draft, setDraft] = useState<Draft | null>(null)
  const [sent, setSent] = useState(false)

  const run = (next: DraftOptions) => {
    setOptions(next)
    setSent(false)
    setDraft(generateDraft(items, days, selfId, partnerId, next))
  }

  return (
    <Card>
      <CardContent className="space-y-4 py-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="mr-auto">
            <p className="font-medium">Lay out a draft</p>
            <p className="text-xs text-muted-foreground">
              Built here in the browser from what you have both saved. No AI, and nothing lands in
              the plan until you say so.
            </p>
          </div>
          <Button onClick={() => run(options)} disabled={days.length === 0}>
            <Sparkles aria-hidden="true" />
            {draft ? 'Regenerate' : 'Generate'}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Pace</span>
          {PACES.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              aria-pressed={options.pace === value}
              onClick={() => run({ ...options, pace: value })}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                options.pace === value
                  ? 'border-transparent bg-secondary text-secondary-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}

          <span className="ml-2 text-xs text-muted-foreground">Bias</span>
          <button
            type="button"
            aria-pressed={Boolean(options.moreFood)}
            onClick={() => run({ ...options, moreFood: !options.moreFood })}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              options.moreFood
                ? 'border-transparent bg-secondary text-secondary-foreground'
                : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            More food
          </button>
          <button
            type="button"
            aria-pressed={Boolean(options.skipMuseums)}
            onClick={() => run({ ...options, skipMuseums: !options.skipMuseums })}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              options.skipMuseums
                ? 'border-transparent bg-secondary text-secondary-foreground'
                : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            Skip museums
          </button>
        </div>

        {days.length === 0 && (
          <p className="text-xs text-muted-foreground">
            This trip has no dates yet, so there are no days to lay anything out on.
          </p>
        )}

        {draft && (
          <div className="space-y-3 rounded-md border border-border p-4">
            <p className="text-sm">{draft.note}</p>

            {draft.days.map((day) => (
              <div key={day.date} className="text-sm">
                <span className="font-medium">{day.date}</span>
                <span className="ml-2 text-muted-foreground">
                  {day.items.map((i) => i.title).join(' · ')}
                </span>
              </div>
            ))}

            {draft.openDays.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {pluralise(draft.openDays.length, 'day')} left open on purpose.
              </p>
            )}

            {draft.days.length > 0 &&
              (sent ? (
                <p className="text-sm text-[hsl(var(--ok))]">
                  In the tray on the plan tab. Nothing has been added to the itinerary.
                </p>
              ) : (
                <Button
                  variant="outline"
                  disabled={save.isPending}
                  onClick={() =>
                    save.mutate(
                      { draft, pace: options.pace },
                      { onSuccess: () => setSent(true) },
                    )
                  }
                >
                  {save.isPending ? 'Sending…' : 'Send to the tray'}
                </Button>
              ))}

            {save.error ? (
              <p className="text-sm text-destructive" role="alert">
                {userMessage(save.error)}
              </p>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
