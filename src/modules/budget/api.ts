/** Module 13 — Budget. Supabase access only; no React in here. */
'use client'

import { supabase } from '@/lib/supabase/client'
import { toAppError, unwrap, unwrapList } from '@/lib/errors'
import type { UpdateDto } from '@/types/database'
import { toBase } from './logic'
import type { Budget, Expense, ExpenseCategory, ExpenseFilters, Settlement } from './types'
import type { ExpenseFormValues, SettlementFormValues } from './schemas'

const EXPENSE_COLUMNS = '*'

export async function listCategories(): Promise<ExpenseCategory[]> {
  return unwrapList(
    await supabase.from('expense_categories').select('*').order('sort_order', { ascending: true }),
  )
}

/**
 * A trip's expenses, or the couple's whole history when `tripId` is undefined.
 *
 * `tripId: null` is different from omitting it: null means the expenses that
 * belong to no trip, which is a real filter (spec 13.6 allows them).
 */
export async function listExpenses(filters: ExpenseFilters = {}): Promise<Expense[]> {
  let query = supabase
    .from('expenses')
    .select(EXPENSE_COLUMNS)
    .is('deleted_at', null)
    .order('spent_on', { ascending: false })
    .order('created_at', { ascending: false })

  if (filters.tripId !== undefined) {
    query = filters.tripId === null ? query.is('trip_id', null) : query.eq('trip_id', filters.tripId)
  }
  if (filters.categoryId) query = query.eq('category_id', filters.categoryId)
  if (filters.paidBy) query = query.eq('paid_by', filters.paidBy)
  if (filters.from) query = query.gte('spent_on', filters.from)
  if (filters.to) query = query.lte('spent_on', filters.to)
  if (filters.search) query = query.ilike('description', `%${filters.search}%`)

  return unwrapList(await query)
}

export async function listSettlements(tripId?: string | null): Promise<Settlement[]> {
  let query = supabase
    .from('settlements')
    .select('*')
    .is('deleted_at', null)
    .order('settled_on', { ascending: false })
  if (tripId !== undefined && tripId !== null) query = query.eq('trip_id', tripId)
  return unwrapList(await query)
}

export async function listBudgets(tripId: string): Promise<Budget[]> {
  return unwrapList(await supabase.from('budgets').select('*').eq('trip_id', tripId))
}

/**
 * Ask the server for the rate that applied on a date.
 *
 * Returns null when no rate could be had — the caller saves the expense
 * unconverted rather than refusing it, and the nightly sweep finishes the job.
 * `fx_rates` is not writable from the browser, which is why this is a fetch to
 * our own handler rather than a Supabase call.
 */
export async function getFxRate(
  base: string,
  quote: string,
  on: string,
): Promise<{ rate: number; rateDate: string } | null> {
  if (base === quote) return { rate: 1, rateDate: on }
  try {
    const response = await fetch('/api/fx', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ base, quote, on }),
    })
    if (!response.ok) return null
    const body = (await response.json()) as { rate: number | null; rateDate?: string }
    return body.rate === null ? null : { rate: body.rate, rateDate: body.rateDate ?? on }
  } catch {
    // Offline, or the handler is down. Same answer either way.
    return null
  }
}

/**
 * Save an expense, converting it at the rate for the day it was spent.
 *
 * The conversion happens here, once, at write time — never at read time. If
 * the rate cannot be had the row saves with all three FX columns null, which
 * the constraint requires to be all-or-nothing and which the backfill sweep
 * treats as its working set.
 */
export async function addExpense(
  coupleId: string,
  userId: string,
  baseCurrency: string,
  values: ExpenseFormValues,
): Promise<Expense> {
  const fx = await getFxRate(baseCurrency, values.currency, values.spent_on)

  return unwrap(
    await supabase
      .from('expenses')
      .insert({
        ...values,
        couple_id: coupleId,
        created_by: userId,
        amount_base: fx ? toBase(values.amount, fx.rate) : null,
        fx_rate: fx ? fx.rate : null,
        fx_date: fx ? fx.rateDate : null,
      })
      .select(EXPENSE_COLUMNS)
      .single(),
  )
}

/**
 * Edit an expense.
 *
 * Amount, currency or date changing means the conversion no longer describes
 * the row, so it is redone. Anything else — a description, a category — leaves
 * the stored rate exactly where it was, which is the point of storing it.
 */
export async function updateExpense(
  id: string,
  patch: UpdateDto<'expenses'>,
  context?: { baseCurrency: string; current: Expense },
): Promise<Expense> {
  let full: UpdateDto<'expenses'> = patch

  const touchesConversion =
    patch.amount !== undefined || patch.currency !== undefined || patch.spent_on !== undefined

  if (touchesConversion && context) {
    const amount = Number(patch.amount ?? context.current.amount)
    const currency = patch.currency ?? context.current.currency
    const spentOn = patch.spent_on ?? context.current.spent_on
    const fx = await getFxRate(context.baseCurrency, currency, spentOn)
    full = {
      ...patch,
      amount_base: fx ? toBase(amount, fx.rate) : null,
      fx_rate: fx ? fx.rate : null,
      fx_date: fx ? fx.rateDate : null,
    }
  }

  return unwrap(
    await supabase.from('expenses').update(full).eq('id', id).select(EXPENSE_COLUMNS).single(),
  )
}

/** Soft delete. The balance moves, which is why the UI warns first. */
export async function deleteExpense(id: string): Promise<void> {
  const { error } = await supabase
    .from('expenses')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw toAppError(error)
}

export async function restoreExpense(id: string): Promise<void> {
  const { error } = await supabase.from('expenses').update({ deleted_at: null }).eq('id', id)
  if (error) throw toAppError(error)
}

export async function addSettlement(
  coupleId: string,
  userId: string,
  values: SettlementFormValues,
): Promise<Settlement> {
  return unwrap(
    await supabase
      .from('settlements')
      .insert({ ...values, couple_id: coupleId, created_by: userId })
      .select('*')
      .single(),
  )
}

export async function deleteSettlement(id: string): Promise<void> {
  const { error } = await supabase
    .from('settlements')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw toAppError(error)
}

/**
 * Set or clear a budget.
 *
 * One per trip, category and period — enforced by a partial unique index,
 * because the spec's plain `unique` would not have held for the overall budget
 * where `category_id` is null.
 */
export async function setBudget(
  coupleId: string,
  userId: string,
  tripId: string,
  input: { categoryId: string | null; amount: number | null; currency: string; period?: 'trip' | 'week' },
): Promise<void> {
  const period = input.period ?? 'trip'

  let match = supabase.from('budgets').select('id').eq('trip_id', tripId).eq('period', period)
  match = input.categoryId ? match.eq('category_id', input.categoryId) : match.is('category_id', null)
  const existing = unwrapList(await match.limit(1))

  if (input.amount === null) {
    if (existing[0]) {
      const { error } = await supabase.from('budgets').delete().eq('id', existing[0].id)
      if (error) throw toAppError(error)
    }
    return
  }

  if (existing[0]) {
    const { error } = await supabase
      .from('budgets')
      .update({ amount: input.amount, currency: input.currency })
      .eq('id', existing[0].id)
    if (error) throw toAppError(error)
    return
  }

  const { error } = await supabase.from('budgets').insert({
    couple_id: coupleId,
    trip_id: tripId,
    category_id: input.categoryId,
    amount: input.amount,
    currency: input.currency,
    period,
    created_by: userId,
  })
  if (error) throw toAppError(error)
}

export async function updateBaseCurrency(coupleId: string, currency: string): Promise<void> {
  const { error } = await supabase
    .from('couples')
    .update({ base_currency: currency })
    .eq('id', coupleId)
  if (error) throw toAppError(error)
}
