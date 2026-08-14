/**
 * Trip summary: totals, categories, people, and the per-week view spec 13.2
 * asks for by name because "a month-long total is hard to reason about".
 */
'use client'

import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/common/states'
import { useCouple } from '@/providers/CoupleProvider'
import { formatMoney, worthShowingWeeks } from '../logic'
import { BudgetBar, DonutChart, LineChart, StackedBar } from './charts'
import type { Summary } from '../types'

export function SummaryPanel({
  summary,
  onSetBudget,
  savingBudget,
}: {
  summary: Summary
  onSetBudget?: (categoryId: string | null, amount: number | null) => void
  savingBudget?: boolean
}) {
  const { selfRef, partnerRef } = useCouple()
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  if (summary.total === 0 && summary.unconverted === 0) {
    return (
      <EmptyState
        title="Nothing to summarise yet"
        description="Totals, categories and the per-week view appear once there is something to add up."
      />
    )
  }

  const people = [selfRef, partnerRef].filter(Boolean)
  const contributions = people.map((person) => {
    const row = summary.byPerson.find((p) => p.userId === person!.id)
    return {
      label: person!.isSelf ? 'You' : person!.displayName,
      segments: [
        {
          label: 'paid',
          value: row?.paid ?? 0,
          color: person!.isSelf ? '#60a5fa' : '#f472b6',
        },
      ],
    }
  })

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Total</p>
            <p className="text-2xl font-semibold tabular-nums">
              {formatMoney(summary.total, summary.currency)}
            </p>
          </div>
          {summary.days > 0 && (
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Per day</p>
              <p className="text-lg tabular-nums">
                {formatMoney(summary.perDayAverage, summary.currency)}
              </p>
              <p className="text-xs text-muted-foreground">
                over {summary.days} {summary.days === 1 ? 'day' : 'days'}
              </p>
            </div>
          )}
        </div>

        {summary.unconverted > 0 && (
          <p className="mt-3 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-500">
            {summary.unconverted === 1 ? 'One expense is' : `${summary.unconverted} expenses are`}{' '}
            waiting on an exchange rate and {summary.unconverted === 1 ? 'is' : 'are'} not counted
            above.
          </p>
        )}
      </Card>

      {summary.byCategory.length > 0 && (
        <Card className="space-y-4 p-5">
          <h3 className="text-sm font-medium">Where it went</h3>
          <DonutChart
            slices={summary.byCategory.map((c) => ({
              label: c.name,
              value: c.total,
              color: c.color,
            }))}
            currency={summary.currency}
          />

          {/* Budget vs actual, but only where a budget was actually set. */}
          <div className="space-y-3 border-t border-border pt-4">
            {summary.byCategory.map((category) => (
              <div key={category.categoryId ?? 'none'} className="space-y-1">
                {category.budget !== null ? (
                  <>
                    <p className="text-xs font-medium">{category.name}</p>
                    <BudgetBar
                      spent={category.total}
                      budget={category.budget}
                      currency={summary.currency}
                    />
                  </>
                ) : null}

                {onSetBudget && category.categoryId && (
                  <>
                    {editing === category.categoryId ? (
                      <form
                        className="flex items-end gap-2"
                        onSubmit={(e) => {
                          e.preventDefault()
                          const value = draft.trim() === '' ? null : Number(draft.replace(',', '.'))
                          if (value !== null && (!Number.isFinite(value) || value <= 0)) return
                          onSetBudget(category.categoryId, value)
                          setEditing(null)
                        }}
                      >
                        <Input
                          autoFocus
                          inputMode="decimal"
                          value={draft}
                          placeholder={`Budget for ${category.name}`}
                          aria-label={`Budget for ${category.name} in ${summary.currency}`}
                          onChange={(e) => setDraft(e.target.value)}
                        />
                        <Button type="submit" size="sm" disabled={savingBudget}>
                          Save
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditing(null)}
                        >
                          Cancel
                        </Button>
                      </form>
                    ) : (
                      <button
                        type="button"
                        className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                        onClick={() => {
                          setDraft(category.budget === null ? '' : String(category.budget))
                          setEditing(category.categoryId)
                        }}
                      >
                        {category.budget === null
                          ? `Set a budget for ${category.name}`
                          : `Change the ${category.name} budget`}
                      </button>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {summary.byDay.length > 1 && (
        <Card className="space-y-3 p-5">
          <h3 className="text-sm font-medium">Spend over time</h3>
          <LineChart
            points={summary.byDay.map((d) => ({ label: d.date, value: d.total }))}
            currency={summary.currency}
          />
        </Card>
      )}

      {/* The per-week view. Only on stays long enough for it to say anything
          a daily line does not — under a fortnight it is two bars. */}
      {worthShowingWeeks(summary.days) && summary.byWeek.length > 0 && (
        <Card className="space-y-3 p-5">
          <h3 className="text-sm font-medium">By week</h3>
          <ul className="space-y-2">
            {summary.byWeek.map((week) => {
              const peak = Math.max(...summary.byWeek.map((w) => w.total), 1)
              return (
                <li key={week.index} className="flex items-center gap-3 text-sm">
                  <span className="w-16 shrink-0 text-muted-foreground">Week {week.index}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{ width: `${(week.total / peak) * 100}%` }}
                    />
                  </div>
                  <span className="w-24 shrink-0 text-right tabular-nums">
                    {formatMoney(week.total, summary.currency)}
                  </span>
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      {contributions.length > 0 && (
        <Card className="space-y-3 p-5">
          <h3 className="text-sm font-medium">Who paid what</h3>
          <StackedBar rows={contributions} currency={summary.currency} />
          <p className="text-xs text-muted-foreground">
            What each of you paid out. Who owed what is the balance above — the two are different
            numbers whenever one of you covers more than their share.
          </p>
        </Card>
      )}
    </div>
  )
}
