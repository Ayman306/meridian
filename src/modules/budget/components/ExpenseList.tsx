/** The ledger: one row per expense, grouped by day. Spec 13.2. */
'use client'

import { AlertTriangle, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState, ErrorState, SkeletonList } from '@/components/common/states'
import { PersonBadge } from '@/components/PersonBadge'
import { formatInZone } from '@/lib/dates'
import { useCouple } from '@/providers/CoupleProvider'
import { formatMoney } from '../logic'
import type { Expense, ExpenseCategory } from '../types'

export function ExpenseList({
  expenses,
  categories,
  baseCurrency,
  isLoading,
  error,
  onEdit,
  onDelete,
  onAdd,
}: {
  expenses: Expense[]
  categories: ExpenseCategory[]
  baseCurrency: string
  isLoading?: boolean
  error?: unknown
  onEdit: (expense: Expense) => void
  onDelete: (expense: Expense) => void
  onAdd?: () => void
}) {
  const { selfRef, partnerRef, tzSelf } = useCouple()

  if (isLoading) return <SkeletonList rows={4} />
  if (error) return <ErrorState error={error} title="The expenses did not load" />
  if (expenses.length === 0) {
    return (
      <EmptyState
        title="Nothing spent yet"
        description="Add the first one and the balance works itself out from there."
        action={onAdd ? <Button onClick={onAdd}>Add an expense</Button> : undefined}
      />
    )
  }

  const days = groupByDay(expenses)

  return (
    <div className="space-y-6">
      {days.map(([date, rows]) => (
        <section key={date} className="space-y-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {formatInZone(`${date}T12:00:00Z`, tzSelf, 'EEE d MMM yyyy')}
          </h3>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {rows.map((expense) => {
              const payer = expense.paid_by === selfRef?.id ? selfRef : partnerRef
              const category = categories.find((c) => c.id === expense.category_id)
              const unconverted = expense.amount_base === null

              return (
                <li key={expense.id} className="flex items-center gap-3 px-3 py-2.5">
                  <PersonBadge person={payer} size="xs" />

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{expense.description}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {category?.name ?? 'Uncategorised'}
                      {expense.split_type === 'full' && ' · covered, not split'}
                      {expense.split_type === 'exact' && ' · exact split'}
                      {expense.split_type === 'percent' && ' · split by percentage'}
                    </p>
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="text-sm tabular-nums">
                      {formatMoney(Number(expense.amount), expense.currency)}
                    </p>
                    {expense.currency !== baseCurrency && (
                      <p className="text-xs tabular-nums text-muted-foreground">
                        {unconverted ? (
                          <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-500">
                            <AlertTriangle className="size-3" aria-hidden="true" />
                            not converted yet
                          </span>
                        ) : (
                          formatMoney(Number(expense.amount_base), baseCurrency)
                        )}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit ${expense.description}`}
                      onClick={() => onEdit(expense)}
                    >
                      <Pencil className="size-4" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${expense.description}`}
                      onClick={() => onDelete(expense)}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}

function groupByDay(expenses: Expense[]): [string, Expense[]][] {
  const byDay = new Map<string, Expense[]>()
  for (const expense of expenses) {
    const bucket = byDay.get(expense.spent_on)
    if (bucket) bucket.push(expense)
    else byDay.set(expense.spent_on, [expense])
  }
  // Newest first, matching the query's own ordering.
  return [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]))
}
