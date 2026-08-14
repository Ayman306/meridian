/**
 * The rate that applied on the day money was spent.
 *
 * Server-side because `fx_rates` is written by the service role and by nothing
 * else: a poisoned rate is a wrong number in somebody's balance, so the
 * browser can read the cache but never fill it (see 0012_budget).
 *
 * Answers `{ rate: null }` rather than an error when every route fails. The
 * client saves the expense unconverted and the nightly sweep picks it up —
 * spec 13.6.
 */
import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/supabase/server'
import { getRate } from '@/lib/fx'
import { fxRequestSchema } from '@/modules/budget/schemas'
import { todayIn } from '@/lib/dates'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const body = fxRequestSchema.safeParse(await request.json().catch(() => null))
  if (!body.success) {
    return NextResponse.json({ error: 'Send base, quote and a date.' }, { status: 400 })
  }

  const { base, quote, on } = body.data

  // A rate for tomorrow does not exist. Asking for one is either a clock skew
  // or a typo, and either way today's is the honest answer.
  const today = todayIn('UTC')
  const asked = on > today ? today : on

  const result = await getRate(base, quote, asked)
  if (!result) return NextResponse.json({ rate: null })

  return NextResponse.json({
    rate: result.rate,
    rateDate: result.rateDate,
    source: result.source,
  })
}
