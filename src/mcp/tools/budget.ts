/**
 * Money. Read the spend, add an expense.
 *
 * Currency is never assumed. `log_expense` requires it, because an amount
 * without one is not a quantity of anything, and a model that defaults to USD
 * for a couple splitting dirhams produces a settlement that is quietly wrong
 * for months.
 *
 * Conversion is left alone entirely: `amount_base` and `fx_rate` are filled by
 * the FX backfill job against a rate for the day it was spent, and a rate this
 * server guessed would be both less accurate and indistinguishable afterwards
 * from a real one.
 */
import { z } from 'zod'
import { defineTool, requireCouple } from './types'
import type { AnyTool } from './types'

const getBudget = defineTool({
  name: 'get_budget',
  module: 'money',
  title: 'Get spending',
  description:
    'Expenses for a trip, or across everything, with per-currency totals. Amounts are shown in the currency they were spent in — totals are not summed across currencies, because that would need a rate this tool does not apply.',
  readOnly: true,
  inputSchema: z.object({
    trip_id: z
      .string()
      .uuid()
      .nullable()
      .default(null)
      .describe('Restrict to one trip. Omit for everything, including spending with no trip.'),
    limit: z.number().int().min(1).max(200).default(50).describe('How many to return, newest first.'),
  }),
  async handler(ctx, input) {
    requireCouple(ctx)

    let query = ctx.supabase
      .from('expenses')
      .select('id, description, amount, currency, spent_on, split_type, notes')
      .is('deleted_at', null)
      .order('spent_on', { ascending: false })
      .limit(input.limit)

    if (input.trip_id) query = query.eq('trip_id', input.trip_id)

    const { data, error } = await query
    if (error) throw new Error(error.message)
    const rows = data ?? []
    if (rows.length === 0) return 'No expenses recorded.'

    const totals = new Map<string, number>()
    for (const row of rows) {
      totals.set(row.currency, (totals.get(row.currency) ?? 0) + Number(row.amount))
    }

    const lines = rows.map((row) => {
      const parts = [row.spent_on, `${row.currency} ${Number(row.amount).toFixed(2)}`, row.description]
      if (row.split_type !== 'equal') parts.push(`split: ${row.split_type}`)
      if (row.notes) parts.push(`— ${row.notes}`)
      return `- ${parts.join(' · ')}`
    })

    const summary = [...totals]
      .map(([currency, total]) => `${currency} ${total.toFixed(2)}`)
      .join(', ')

    return [
      `${rows.length} expense${rows.length === 1 ? '' : 's'}. Totals by currency: ${summary}.`,
      '',
      ...lines,
    ].join('\n')
  },
})

const logExpense = defineTool({
  name: 'log_expense',
  module: 'money',
  title: 'Log an expense',
  description:
    'Record something that was paid for. Writes immediately — this is for spending that has actually happened, which the person is telling you about. Currency is required; do not guess it from the destination.',
  readOnly: false,
  inputSchema: z.object({
    description: z.string().min(1).describe('What it was for.'),
    amount: z.number().positive().describe('In major units — 12.50, not 1250.'),
    currency: z
      .string()
      .length(3)
      .describe('ISO 4217, uppercase. Ask rather than assuming it from the country.'),
    spent_on: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .describe('YYYY-MM-DD, the day it was actually spent.'),
    trip_id: z.string().uuid().nullable().default(null).describe('Attach it to a trip, if it belongs to one.'),
    split_type: z
      .enum(['equal', 'full'])
      .default('equal')
      .describe(
        'equal splits it down the middle; full means the payer covers all of it. Uneven splits need the app — they carry per-person detail this tool does not take.',
      ),
    notes: z.string().nullable().default(null).describe('Anything worth remembering about it.'),
  }),
  async handler(ctx, input) {
    const coupleId = requireCouple(ctx)

    const { data, error } = await ctx.supabase
      .from('expenses')
      .insert({
        couple_id: coupleId,
        trip_id: input.trip_id,
        description: input.description,
        amount: input.amount,
        currency: input.currency.toUpperCase(),
        spent_on: input.spent_on,
        // Whoever holds the token is the one recording it, and — absent
        // anything saying otherwise — the one who paid. `paid_by` drives who
        // owes whom, so it is stated here rather than defaulted in SQL.
        paid_by: ctx.userId,
        created_by: ctx.userId,
        split_type: input.split_type,
        notes: input.notes,
      })
      .select('id')
      .single()

    if (error) throw new Error(error.message)
    return [
      `Logged ${input.currency.toUpperCase()} ${input.amount.toFixed(2)} for "${input.description}" on ${input.spent_on} (${data.id}).`,
      'Recorded as paid by you. Change that in the app if it was not.',
    ].join(' ')
  },
})



const listSettlements = defineTool({
  name: 'list_settlements',
  module: 'money',
  title: 'List settlements',
  description:
    'Money actually moved between the two of them to square up — as opposed to expenses, which are what was spent. Use both to answer "who owes whom".',
  readOnly: true,
  inputSchema: z.object({
    trip_id: z.string().uuid().nullable().default(null).describe('Restrict to one trip.'),
    limit: z.number().int().min(1).max(100).default(30).describe('How many to return, newest first.'),
  }),
  async handler(ctx, input) {
    requireCouple(ctx)

    let query = ctx.supabase
      .from('settlements')
      .select('id, amount, currency, settled_on, method, notes, from_user, to_user')
      .is('deleted_at', null)
      .order('settled_on', { ascending: false })
      .limit(input.limit)
    if (input.trip_id) query = query.eq('trip_id', input.trip_id)

    const { data, error } = await query
    if (error) throw new Error(error.message)
    const rows = data ?? []
    if (rows.length === 0) return 'No settlements recorded.'

    return rows
      .map((row) => {
        const direction = row.from_user === ctx.userId ? 'you paid them' : 'they paid you'
        const parts = [row.settled_on, `${row.currency} ${Number(row.amount).toFixed(2)}`, direction]
        if (row.method) parts.push(row.method)
        if (row.notes) parts.push(`— ${row.notes}`)
        return `- ${parts.join(' · ')}`
      })
      .join('\n')
  },
})

const recordSettlement = defineTool({
  name: 'record_settlement',
  module: 'money',
  title: 'Record a settlement',
  description:
    'Record that one of them actually paid the other back. This is money that has already moved — it does not transfer anything, it writes down that a transfer happened.',
  readOnly: false,
  inputSchema: z.object({
    amount: z.number().positive().describe('In major units — 40.00, not 4000.'),
    currency: z.string().length(3).describe('ISO 4217, uppercase. Ask rather than assuming.'),
    settled_on: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .describe('YYYY-MM-DD, the day the money moved.'),
    direction: z
      .enum(['i_paid_them', 'they_paid_me'])
      .describe('Which way it went, from the point of view of whoever owns this token.'),
    trip_id: z.string().uuid().nullable().default(null).describe('Attach it to a trip, if it belongs to one.'),
    method: z.string().nullable().default(null).describe('How — "bank transfer", "cash".'),
    notes: z.string().nullable().default(null).describe('Anything worth remembering.'),
  }),
  async handler(ctx, input) {
    const coupleId = requireCouple(ctx)

    // The other member, found rather than asked for: a settlement has exactly
    // two sides and one of them is always the caller, so a partner id in the
    // schema would be a parameter with one correct value.
    const { data: partnerId, error: partnerError } = await ctx.supabase.rpc('partner_id')
    if (partnerError) throw new Error(partnerError.message)
    if (!partnerId) return 'There is nobody to settle up with yet — this account is not paired.'

    const iPaid = input.direction === 'i_paid_them'

    const { data, error } = await ctx.supabase
      .from('settlements')
      .insert({
        couple_id: coupleId,
        trip_id: input.trip_id,
        amount: input.amount,
        currency: input.currency.toUpperCase(),
        settled_on: input.settled_on,
        from_user: iPaid ? ctx.userId : partnerId,
        to_user: iPaid ? partnerId : ctx.userId,
        method: input.method,
        notes: input.notes,
        created_by: ctx.userId,
      })
      .select('id')
      .single()
    if (error) throw new Error(error.message)

    return `Recorded ${input.currency.toUpperCase()} ${input.amount.toFixed(2)} on ${input.settled_on} — ${iPaid ? 'you paid them' : 'they paid you'} (${data.id}).`
  },
})



const setBudget = defineTool({
  name: 'set_budget',
  module: 'money',
  title: 'Set a budget',
  description:
    'Set a spending target for a trip, either for the whole trip or per week. Replaces any existing budget for the same trip, period and category.',
  readOnly: false,
  inputSchema: z.object({
    trip_id: z.string().uuid().describe('From list_trips.'),
    amount: z.number().positive().describe('In major units — 1500.00, not 150000.'),
    currency: z.string().length(3).describe('ISO 4217, uppercase. Ask rather than assuming.'),
    period: z
      .enum(['trip', 'week'])
      .default('trip')
      .describe('`trip` is a total for the whole thing; `week` is a weekly rate.'),
  }),
  async handler(ctx, input) {
    const coupleId = requireCouple(ctx)

    // Replace rather than accumulate: setting a budget twice should leave one
    // budget, not two that quietly sum.
    const { error: clearError } = await ctx.supabase
      .from('budgets')
      .delete()
      .eq('trip_id', input.trip_id)
      .eq('period', input.period)
      .is('category_id', null)
    if (clearError) throw new Error(clearError.message)

    const { data, error } = await ctx.supabase
      .from('budgets')
      .insert({
        couple_id: coupleId,
        trip_id: input.trip_id,
        amount: input.amount,
        currency: input.currency.toUpperCase(),
        period: input.period,
        created_by: ctx.userId,
      })
      .select('id')
      .single()
    if (error) throw new Error(error.message)

    return `Set a ${input.period} budget of ${input.currency.toUpperCase()} ${input.amount.toFixed(2)} (${data.id}).`
  },
})

const getBudgets = defineTool({
  name: 'get_budgets',
  module: 'money',
  title: 'Get budgets',
  description:
    'The spending targets set for a trip. Compare against get_budget for what has actually been spent — this tool does not do that comparison, because the two can be in different currencies.',
  readOnly: true,
  inputSchema: z.object({
    trip_id: z.string().uuid().describe('From list_trips.'),
  }),
  async handler(ctx, input) {
    requireCouple(ctx)

    const { data, error } = await ctx.supabase
      .from('budgets')
      .select('id, amount, currency, period, category_id')
      .eq('trip_id', input.trip_id)
    if (error) throw new Error(error.message)

    const rows = data ?? []
    if (rows.length === 0) return 'No budget set for this trip.'

    return rows
      .map((row) => `- ${row.period}: ${row.currency} ${Number(row.amount).toFixed(2)}`)
      .join('\n')
  },
})

export const budgetTools: AnyTool[] = [
  getBudget,
  logExpense,
  listSettlements,
  recordSettlement,
  setBudget,
  getBudgets,
]
