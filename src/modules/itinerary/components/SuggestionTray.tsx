/**
 * Where generated plans wait.
 *
 * Non-negotiable #5: nothing auto-inserts. Everything the draft generator
 * produces arrives here and stays here until somebody presses Keep — and the
 * tray says so plainly, because a user who thinks their plan changed by itself
 * will stop trusting the plan.
 */
'use client'

import { Check, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { formatInZone, parseDateOnly } from '@/lib/dates'
import { userMessage } from '@/lib/errors'
import { pluralise } from '@/lib/utils'
import type { TrayDraft } from '@/types/domain'
import { useAcceptSuggestion, useDismissSuggestion, useSuggestionTray } from '../hooks'

export function SuggestionTray({ tripId }: { tripId: string }) {
  const tray = useSuggestionTray(tripId)
  const accept = useAcceptSuggestion(tripId)
  const dismiss = useDismissSuggestion(tripId)

  const suggestions = tray.data ?? []
  if (suggestions.length === 0) return null

  return (
    <div className="space-y-3">
      {suggestions.map((suggestion) => {
        const draft = suggestion.payload as unknown as TrayDraft
        const days = Array.isArray(draft?.days) ? draft.days : []
        const count = days.reduce((n, day) => n + (day.items?.length ?? 0), 0)

        return (
          <Card key={suggestion.id} className="border-accent/40 bg-accent/5">
            <CardContent className="space-y-3 py-5">
              <div className="flex flex-wrap items-start gap-3">
                <Sparkles className="mt-0.5 size-4 text-accent" aria-hidden="true" />
                <div className="mr-auto">
                  <p className="font-medium">
                    A draft — {pluralise(count, 'place')} over {pluralise(days.length, 'day')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {draft?.note ?? 'Nothing has been added to your plan.'}
                  </p>
                </div>
              </div>

              <ul className="space-y-1 text-sm">
                {days.map((day) => (
                  <li key={day.date}>
                    <span className="font-medium">
                      {formatInZone(parseDateOnly(day.date), 'UTC', 'EEE d MMM')}
                    </span>
                    <span className="ml-2 text-muted-foreground">
                      {(day.items ?? []).map((i) => i.title).join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>

              {accept.error ? (
                <p className="text-sm text-destructive" role="alert">
                  {userMessage(accept.error)}
                </p>
              ) : null}

              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={accept.isPending}
                  onClick={() => accept.mutate(suggestion.id)}
                >
                  <Check aria-hidden="true" />
                  {accept.isPending ? 'Adding…' : 'Keep it'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={dismiss.isPending}
                  onClick={() => dismiss.mutate(suggestion.id)}
                >
                  <X aria-hidden="true" />
                  Discard
                </Button>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
