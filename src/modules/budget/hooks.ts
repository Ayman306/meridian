'use client'

import { useEffect, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { qk } from '@/lib/queryClient'
import { supabase } from '@/lib/supabase/client'
import { useAuth } from '@/providers/AuthProvider'
import { useCouple } from '@/providers/CoupleProvider'
import type { UpdateDto } from '@/types/database'
import * as api from './api'
import { balance, describeBalance, summarise } from './logic'
import type { Balance, BalanceLine, Expense, ExpenseFilters, Pair, Summary } from './types'
import type { ExpenseFormValues, SettlementFormValues } from './schemas'

/** The couple's base currency, with a defined answer before it has loaded. */
export function useBaseCurrency(): string {
  const { couple } = useCouple()
  return couple?.base_currency ?? 'USD'
}

/**
 * The two people, in the order the arithmetic expects: `a` is always the
 * viewer, so a positive balance always means "you are owed".
 *
 * In solo mode the partner slot holds a sentinel rather than null. Nothing can
 * be split with someone who is not there, and `full` is the only split type
 * whose result is meaningful — but the summary screens still have to render.
 */
export function usePair(): Pair {
  const { user } = useAuth()
  const { partner } = useCouple()
  return useMemo(
    () => ({ a: user?.id ?? 'self', b: partner?.id ?? 'partner' }),
    [user?.id, partner?.id],
  )
}

export function useExpenseCategories() {
  const { coupleId } = useCouple()
  return useQuery({
    queryKey: qk.expenseCategories,
    queryFn: api.listCategories,
    enabled: Boolean(coupleId),
    // Seeded on couple creation and rarely renamed.
    staleTime: 5 * 60_000,
  })
}

export function useExpenses(filters: ExpenseFilters = {}) {
  const { coupleId } = useCouple()
  const scope = JSON.stringify(filters)
  return useQuery({
    queryKey: qk.expenses(`${coupleId ?? 'none'}:${scope}`),
    queryFn: () => api.listExpenses(filters),
    enabled: Boolean(coupleId),
  })
}

export function useSettlements(tripId?: string | null) {
  const { coupleId } = useCouple()
  return useQuery({
    queryKey: qk.settlements(`${coupleId ?? 'none'}:${tripId ?? 'all'}`),
    queryFn: () => api.listSettlements(tripId),
    enabled: Boolean(coupleId),
  })
}

export function useBudgets(tripId: string | null) {
  return useQuery({
    queryKey: qk.budgets(tripId ?? 'none'),
    queryFn: () => api.listBudgets(tripId!),
    enabled: Boolean(tripId),
  })
}

export function useAddExpense() {
  const qc = useQueryClient()
  const { coupleId } = useCouple()
  const { user } = useAuth()
  const baseCurrency = useBaseCurrency()
  return useMutation({
    mutationFn: (values: ExpenseFormValues) =>
      api.addExpense(coupleId!, user!.id, baseCurrency, values),
    onSuccess: () => invalidate(qc),
  })
}

export function useUpdateExpense() {
  const qc = useQueryClient()
  const baseCurrency = useBaseCurrency()
  return useMutation({
    mutationFn: ({
      id,
      patch,
      current,
    }: {
      id: string
      patch: UpdateDto<'expenses'>
      current?: Expense
    }) => api.updateExpense(id, patch, current ? { baseCurrency, current } : undefined),
    onSuccess: () => invalidate(qc),
  })
}

export function useDeleteExpense() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: api.deleteExpense, onSuccess: () => invalidate(qc) })
}

export function useAddSettlement() {
  const qc = useQueryClient()
  const { coupleId } = useCouple()
  const { user } = useAuth()
  return useMutation({
    mutationFn: (values: SettlementFormValues) => api.addSettlement(coupleId!, user!.id, values),
    onSuccess: () => invalidate(qc),
  })
}

export function useDeleteSettlement() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: api.deleteSettlement, onSuccess: () => invalidate(qc) })
}

export function useSetBudget(tripId: string) {
  const qc = useQueryClient()
  const { coupleId } = useCouple()
  const { user } = useAuth()
  return useMutation({
    mutationFn: (input: Parameters<typeof api.setBudget>[3]) =>
      api.setBudget(coupleId!, user!.id, tripId, input),
    onSuccess: () => invalidate(qc),
  })
}

export function useSetBaseCurrency() {
  const qc = useQueryClient()
  const { coupleId } = useCouple()
  return useMutation({
    mutationFn: (currency: string) => api.updateBaseCurrency(coupleId!, currency),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.couple })
      invalidate(qc)
    },
  })
}

/**
 * Who owes whom, for a trip or across everything.
 *
 * Derived rather than fetched: the rows are already in the cache for the list
 * beside it, and a second source of truth for a number this consequential is
 * how the two end up disagreeing on screen.
 */
export function useBalance(tripId?: string | null): {
  balance: Balance
  line: BalanceLine
  isLoading: boolean
} {
  const pair = usePair()
  const currency = useBaseCurrency()
  const expenses = useExpenses(tripId === undefined ? {} : { tripId })
  const settlements = useSettlements(tripId)

  return useMemo(() => {
    const result = balance(expenses.data ?? [], settlements.data ?? [], pair, currency)
    return {
      balance: result,
      // `a` is the viewer, so the sign already points the right way.
      line: describeBalance(result, true),
      isLoading: expenses.isLoading || settlements.isLoading,
    }
  }, [expenses.data, expenses.isLoading, settlements.data, settlements.isLoading, pair, currency])
}

export function useTripSummary(
  tripId: string,
  range?: { start: string; end: string } | null,
): { summary: Summary; isLoading: boolean; error: unknown } {
  const pair = usePair()
  const currency = useBaseCurrency()
  const expenses = useExpenses({ tripId })
  const categories = useExpenseCategories()
  const budgets = useBudgets(tripId)

  return useMemo(
    () => ({
      summary: summarise(
        expenses.data ?? [],
        categories.data ?? [],
        budgets.data ?? [],
        pair,
        currency,
        range,
      ),
      isLoading: expenses.isLoading || categories.isLoading || budgets.isLoading,
      error: expenses.error ?? categories.error ?? budgets.error,
    }),
    [expenses, categories, budgets, pair, currency, range],
  )
}

/**
 * Two people entering expenses on the same evening is exactly the case where a
 * stale balance misleads, so this module subscribes.
 */
export function useBudgetRealtime() {
  const qc = useQueryClient()
  const { coupleId } = useCouple()

  useEffect(() => {
    if (!coupleId) return
    const refresh = () => invalidate(qc)
    const channel = supabase
      .channel(`budget:${coupleId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'expenses', filter: `couple_id=eq.${coupleId}` },
        refresh,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'settlements', filter: `couple_id=eq.${coupleId}` },
        refresh,
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [coupleId, qc])
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'expenses' })
  void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'settlements' })
  void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'budgets' })
}
