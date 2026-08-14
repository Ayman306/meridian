/**
 * Convert the expenses that were saved when the FX provider was down.
 *
 * Spec 13.6: an expense whose rate lookup failed still saves, with
 * `amount_base` null, and is retried later. This is later. `amount_base is
 * null` is the whole working set — there is no separate flag column to drift
 * out of sync with it.
 *
 * Bounded per run: an outage that lasted a week should not turn into one
 * request that walks every row and times out. What it misses, the next night
 * picks up.
 */
import { NextResponse } from 'next/server'
import { assertCronRequest } from '@/lib/cron'
import { createAdminSupabase } from '@/lib/supabase/server'
import { getRate } from '@/lib/fx'
import { toBase } from '@/modules/budget/logic'
import { toAppError } from '@/lib/errors'

export const dynamic = 'force-dynamic'

const MAX_PER_RUN = 100

export async function POST(request: Request) {
  try {
    assertCronRequest(request)
  } catch (e) {
    return NextResponse.json({ error: toAppError(e).message }, { status: 401 })
  }

  const db = createAdminSupabase()

  // The couple's base currency travels with the row, because two couples can
  // hold different ones and this runs for all of them at once.
  const { data: pending, error } = await db
    .from('expenses')
    .select('id, amount, currency, spent_on, couple_id, couples(base_currency)')
    .is('amount_base', null)
    .is('deleted_at', null)
    .limit(MAX_PER_RUN)

  if (error) {
    return NextResponse.json({ error: toAppError(error).message }, { status: 500 })
  }

  let converted = 0
  let stillPending = 0

  for (const row of pending ?? []) {
    const base = (row.couples as { base_currency: string } | null)?.base_currency
    if (!base) {
      stillPending += 1
      continue
    }

    const quote = await getRate(base, row.currency, row.spent_on)
    if (!quote) {
      stillPending += 1
      continue
    }

    const { error: updateError } = await db
      .from('expenses')
      .update({
        amount_base: toBase(Number(row.amount), quote.rate),
        fx_rate: quote.rate,
        fx_date: quote.rateDate,
      })
      .eq('id', row.id)
      // Do not overwrite a row somebody converted by hand in the meantime.
      .is('amount_base', null)

    if (updateError) stillPending += 1
    else converted += 1
  }

  return NextResponse.json({
    examined: pending?.length ?? 0,
    converted,
    stillPending,
  })
}
