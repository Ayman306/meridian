/**
 * Lifetime balance and settlement history. Spec 13.5, `/money`.
 *
 * Everything, across every trip and the expenses that belong to none — spec
 * 13.6 allows `trip_id = null` for money spent before a trip existed, and this
 * is the screen where it counts.
 */
'use client'

import { useState } from 'react'
import { ArrowRight, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/layout/PageHeader'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { EmptyState, SkeletonList } from '@/components/common/states'
import { PersonBadge } from '@/components/PersonBadge'
import { formatInZone } from '@/lib/dates'
import { useCouple } from '@/providers/CoupleProvider'
import { BalanceCard } from '../components/BalanceCard'
import { ExpenseForm } from '../components/ExpenseForm'
import { ExpenseList } from '../components/ExpenseList'
import {
  useAddExpense,
  useAddSettlement,
  useBalance,
  useBaseCurrency,
  useBudgetRealtime,
  useDeleteExpense,
  useDeleteSettlement,
  useExpenseCategories,
  useExpenses,
  useSettlements,
} from '../hooks'
import { formatMoney } from '../logic'
import type { Expense, Settlement } from '../types'

export function MoneyPage() {
  const { selfRef, partnerRef, tzSelf } = useCouple()
  const baseCurrency = useBaseCurrency()
  const categories = useExpenseCategories()
  const expenses = useExpenses({})
  const settlements = useSettlements()
  const { balance, line, isLoading } = useBalance()

  const addExpense = useAddExpense()
  const deleteExpense = useDeleteExpense()
  const addSettlement = useAddSettlement()
  const removeSettlement = useDeleteSettlement()

  useBudgetRealtime()

  const [composing, setComposing] = useState(false)
  const [confirming, setConfirming] = useState<Expense | null>(null)
  const [undoing, setUndoing] = useState<Settlement | null>(null)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Money"
        description={`Everything, across every trip. Totals in ${baseCurrency}.`}
        actions={
          <Button onClick={() => setComposing(true)}>
            <Plus aria-hidden="true" />
            Add
          </Button>
        }
      />

      <BalanceCard
        balance={balance}
        line={line}
        isLoading={isLoading}
        onSettle={(values) => addSettlement.mutate(values)}
        settling={addSettlement.isPending}
      />

      {composing && (
        <div className="rounded-lg border border-border p-4">
          <h2 className="mb-3 text-sm font-medium">New expense</h2>
          <ExpenseForm
            pending={addExpense.isPending}
            error={addExpense.error}
            onCancel={() => setComposing(false)}
            onSubmit={(values) =>
              addExpense.mutate(values, { onSuccess: () => setComposing(false) })
            }
          />
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Settlements</h2>
        {settlements.isLoading ? (
          <SkeletonList rows={2} />
        ) : (settlements.data?.length ?? 0) === 0 ? (
          <EmptyState
            title="No payments recorded"
            description="When one of you pays the other back, record it here and the balance resets."
            subtle
          />
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {settlements.data!.map((settled) => {
              const from = settled.from_user === selfRef?.id ? selfRef : partnerRef
              const to = settled.to_user === selfRef?.id ? selfRef : partnerRef
              return (
                <li key={settled.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                  <PersonBadge person={from} size="xs" />
                  <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden="true" />
                  <PersonBadge person={to} size="xs" />
                  <span className="ml-1 tabular-nums">
                    {formatMoney(Number(settled.amount), settled.currency)}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {formatInZone(`${settled.settled_on}T12:00:00Z`, tzSelf, 'd MMM yyyy')}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Undo this settlement"
                    onClick={() => setUndoing(settled)}
                  >
                    Undo
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">All expenses</h2>
        <ExpenseList
          expenses={expenses.data ?? []}
          categories={categories.data ?? []}
          baseCurrency={baseCurrency}
          isLoading={expenses.isLoading}
          error={expenses.error}
          onAdd={() => setComposing(true)}
          onEdit={() => setComposing(false)}
          onDelete={setConfirming}
        />
      </section>

      <ConfirmDialog
        open={confirming !== null}
        title="Delete this expense?"
        description={
          confirming
            ? `“${confirming.description}” — ${formatMoney(
                Number(confirming.amount),
                confirming.currency,
              )}. The balance will change.`
            : ''
        }
        confirmLabel="Delete"
        destructive
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          if (confirming) deleteExpense.mutate(confirming.id)
          setConfirming(null)
        }}
      />

      <ConfirmDialog
        open={undoing !== null}
        title="Undo this settlement?"
        description={
          undoing
            ? `The balance goes back up by ${formatMoney(
                Number(undoing.amount),
                undoing.currency,
              )}.`
            : ''
        }
        confirmLabel="Undo it"
        destructive
        onCancel={() => setUndoing(null)}
        onConfirm={() => {
          if (undoing) removeSettlement.mutate(undoing.id)
          setUndoing(null)
        }}
      />
    </div>
  )
}
