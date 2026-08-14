/**
 * A trip's spending: the ledger, the balance, and the summary. Spec 13.5.
 *
 * Two panes on desktop, tabs on a phone. The balance sits above both, because
 * it is the number people open this screen to see.
 */
'use client'

import { useMemo, useState } from 'react'
import { Download, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/layout/PageHeader'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { cn } from '@/lib/utils'
import { useCouple } from '@/providers/CoupleProvider'
import { ExpenseForm } from '../components/ExpenseForm'
import { ExpenseList } from '../components/ExpenseList'
import { BalanceCard } from '../components/BalanceCard'
import { SummaryPanel } from '../components/SummaryPanel'
import { RateCalculator } from '../components/RateCalculator'
import {
  useAddExpense,
  useAddSettlement,
  useBalance,
  useBaseCurrency,
  useBudgetRealtime,
  useDeleteExpense,
  useDestinationCurrency,
  useExpenseCategories,
  useExpenses,
  useSetBudget,
  useTripSummary,
  useUpdateExpense,
} from '../hooks'
import { formatMoney, toCsv } from '../logic'
import type { Expense } from '../types'

type Tab = 'expenses' | 'summary' | 'convert'

export function TripMoneyPage({
  tripId,
  tripTitle,
  range,
}: {
  tripId: string
  tripTitle?: string
  range?: { start: string; end: string } | null
}) {
  const { selfRef, partnerRef } = useCouple()
  const baseCurrency = useBaseCurrency()
  const destinationCurrency = useDestinationCurrency(tripId)
  const categories = useExpenseCategories()
  const expenses = useExpenses({ tripId })
  const { balance, line, isLoading: balanceLoading } = useBalance(tripId)
  const { summary } = useTripSummary(tripId, range)

  const addExpense = useAddExpense()
  const updateExpense = useUpdateExpense()
  const deleteExpense = useDeleteExpense()
  const addSettlement = useAddSettlement()
  const setBudget = useSetBudget(tripId)

  useBudgetRealtime()

  const [tab, setTab] = useState<Tab>('expenses')
  const [composing, setComposing] = useState(false)
  const [editing, setEditing] = useState<Expense | null>(null)
  const [confirming, setConfirming] = useState<Expense | null>(null)

  const names = useMemo(() => {
    const out: Record<string, string> = {}
    if (selfRef) out[selfRef.id] = selfRef.displayName
    if (partnerRef) out[partnerRef.id] = partnerRef.displayName
    return out
  }, [selfRef, partnerRef])

  const download = () => {
    const csv = toCsv(expenses.data ?? [], categories.data ?? [], names, baseCurrency)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${(tripTitle ?? 'trip').replace(/[^\w-]+/g, '-').toLowerCase()}-expenses.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Money"
        description={
          destinationCurrency && destinationCurrency !== baseCurrency
            ? `Spend in ${destinationCurrency}, totalled in ${baseCurrency}`
            : `What this trip is costing, in ${baseCurrency}`
        }
        actions={
          <>
            <Button
              variant="outline"
              onClick={download}
              disabled={(expenses.data?.length ?? 0) === 0}
            >
              <Download aria-hidden="true" />
              <span className="hidden sm:inline">Export</span>
            </Button>
            <Button
              onClick={() => {
                setEditing(null)
                setComposing(true)
              }}
            >
              <Plus aria-hidden="true" />
              Add
            </Button>
          </>
        }
      />

      <BalanceCard
        balance={balance}
        line={line}
        isLoading={balanceLoading}
        tripId={tripId}
        onSettle={(values) => addSettlement.mutate(values)}
        settling={addSettlement.isPending}
      />

      {(composing || editing) && (
        <div className="rounded-lg border border-border p-4">
          <h2 className="mb-3 text-sm font-medium">
            {editing ? 'Edit expense' : 'New expense'}
          </h2>
          <ExpenseForm
            tripId={tripId}
            existing={editing ?? undefined}
            destinationCurrency={destinationCurrency}
            pending={addExpense.isPending || updateExpense.isPending}
            error={addExpense.error ?? updateExpense.error}
            onCancel={() => {
              setComposing(false)
              setEditing(null)
            }}
            onSubmit={(values) => {
              const done = () => {
                setComposing(false)
                setEditing(null)
              }
              if (editing) {
                updateExpense.mutate(
                  { id: editing.id, patch: values, current: editing },
                  { onSuccess: done },
                )
              } else {
                addExpense.mutate(values, { onSuccess: done })
              }
            }}
          />
        </div>
      )}

      <div className="flex gap-1 overflow-x-auto border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist">
        {(['expenses', 'summary', 'convert'] as Tab[]).map((name) => (
          <button
            key={name}
            role="tab"
            aria-selected={tab === name}
            className={cn(
              '-mb-px shrink-0 whitespace-nowrap border-b-2 px-4 py-2 text-sm capitalize',
              tab === name
                ? 'border-accent font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
      </div>

      {tab === 'convert' ? (
        <RateCalculator baseCurrency={baseCurrency} destinationCurrency={destinationCurrency} />
      ) : tab === 'expenses' ? (
        <ExpenseList
          expenses={expenses.data ?? []}
          categories={categories.data ?? []}
          baseCurrency={baseCurrency}
          isLoading={expenses.isLoading}
          error={expenses.error}
          onAdd={() => setComposing(true)}
          onEdit={(expense) => {
            setComposing(false)
            setEditing(expense)
          }}
          onDelete={setConfirming}
        />
      ) : (
        <SummaryPanel
          summary={summary}
          destinationCurrency={destinationCurrency}
          savingBudget={setBudget.isPending}
          onSetBudget={(categoryId, amount) =>
            setBudget.mutate({ categoryId, amount, currency: baseCurrency })
          }
        />
      )}

      {/* Spec 13.6: deleting a settled expense changes the balance, and the
          warning says so with the number rather than in the abstract. */}
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
    </div>
  )
}
