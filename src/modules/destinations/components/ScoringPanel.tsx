/**
 * The optional scoring sliders (spec 4.2).
 *
 * Every weight starts at zero and ranking stays hidden until one moves, which
 * is the whole design: the board's job is to show differences, and a ranked
 * list is a recommendation. You have to ask for it.
 */
'use client'

import { SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ZERO_WEIGHTS, scoringEnabled } from '../logic'
import type { ScoreWeights } from '../types'

const SLIDERS: { key: keyof ScoreWeights; label: string; hint: string }[] = [
  { key: 'hours', label: 'Shorter flights', hint: 'Total hours in the air, both of you' },
  { key: 'fairness', label: 'Even journey', hint: 'How close your two flights are' },
  { key: 'visa', label: 'Less visa faff', hint: 'Combined paperwork friction' },
  { key: 'season', label: 'Better weather', hint: 'Season band for the trip month' },
  { key: 'cost', label: 'Cheaper', hint: 'Rough daily cost band' },
  { key: 'wishlist', label: 'Places you saved', hint: 'Wishlist items in that city' },
]

export function ScoringPanel({
  weights,
  onChange,
  open,
  onToggle,
}: {
  weights: ScoreWeights
  onChange: (next: ScoreWeights) => void
  open: boolean
  onToggle: () => void
}) {
  return (
    <Card>
      <CardContent className="space-y-4 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onToggle} aria-expanded={open}>
            <SlidersHorizontal aria-hidden="true" />
            {open ? 'Hide weighting' : 'Weigh these up'}
          </Button>
          <p className="mr-auto text-xs text-muted-foreground">
            {scoringEnabled(weights)
              ? 'Ranked by what you said matters. Tap a score to see the breakdown.'
              : 'Off. Nothing is ranked until you move a slider.'}
          </p>
          {scoringEnabled(weights) && (
            <Button variant="ghost" size="sm" onClick={() => onChange(ZERO_WEIGHTS)}>
              Turn off
            </Button>
          )}
        </div>

        {open && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SLIDERS.map(({ key, label, hint }) => (
              <label key={key} className="space-y-1">
                <span className="flex items-baseline justify-between text-sm">
                  {label}
                  <span className="tabular text-xs text-muted-foreground">
                    {Math.round(weights[key] * 100)}%
                  </span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={10}
                  value={Math.round(weights[key] * 100)}
                  onChange={(e) => onChange({ ...weights, [key]: Number(e.target.value) / 100 })}
                  className="w-full accent-[hsl(var(--accent))]"
                  aria-describedby={`weight-${key}-hint`}
                />
                <span id={`weight-${key}-hint`} className="block text-xs text-muted-foreground">
                  {hint}
                </span>
              </label>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
