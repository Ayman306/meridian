/**
 * Foreign exchange rates. Server-only — imported by Route Handlers, never by
 * the browser.
 *
 * The provider is Frankfurter, which reads the European Central Bank's daily
 * reference rates. It is free, needs no key, and serves historical dates,
 * which matters more here than breadth of coverage: this module never asks for
 * a live rate, only for the rate that applied on the day money was spent.
 *
 * That is also why the cache is absolute. A past date's rate cannot change, so
 * a row in `fx_rates` is correct forever and a cache miss is the only reason
 * to make a network call at all. Spec 13.3: "Never re-fetch a past date."
 *
 * The ECB publishes on working days, so a weekend or a holiday has no rate of
 * its own. Frankfurter answers with the most recent working day and tells you
 * which, in its `date` field — we store the row under the date it actually
 * belongs to, so the next lookup for that weekend finds it by falling back to
 * the nearest earlier date rather than calling again.
 */
import { createAdminSupabase } from '@/lib/supabase/server'
import { AppError } from '@/lib/errors'
import type { DateOnly } from '@/lib/dates'

const ENDPOINT = 'https://api.frankfurter.dev/v1'
const TIMEOUT_MS = 6_000

export interface Quote {
  /** Units of `quote` per one unit of `base`. */
  rate: number
  /** The date the rate is actually from, which may be earlier than asked. */
  rateDate: DateOnly
  source: string
}

/**
 * The rate for one pair on one date: cache, then provider, then the nearest
 * earlier cached date.
 *
 * Returns null rather than throwing when every route fails. The caller saves
 * the expense with `amount_base` null and the backfill sweep tries later —
 * refusing to record what somebody spent because a rate lookup failed would be
 * the wrong trade (spec 13.6).
 */
export async function getRate(base: string, quote: string, on: DateOnly): Promise<Quote | null> {
  if (base === quote) return { rate: 1, rateDate: on, source: 'identity' }

  const db = createAdminSupabase()

  const { data: cached } = await db
    .from('fx_rates')
    .select('rate, rate_date, source')
    .eq('base', base)
    .eq('quote', quote)
    .eq('rate_date', on)
    .maybeSingle()

  if (cached) {
    return { rate: Number(cached.rate), rateDate: cached.rate_date, source: cached.source ?? 'cache' }
  }

  const fetched = await fetchRate(base, quote, on).catch(() => null)
  if (fetched) {
    // Ignore a conflict: two saves racing on the same pair and day is a
    // duplicate row, not a problem worth failing a save over.
    await db.from('fx_rates').upsert(
      {
        base,
        quote,
        rate: fetched.rate,
        rate_date: fetched.rateDate,
        source: fetched.source,
      },
      { onConflict: 'base,quote,rate_date' },
    )
    // Also key it under the date that was asked for, when the ECB had no rate
    // that day. Otherwise every future lookup for that weekend calls again.
    if (fetched.rateDate !== on) {
      await db.from('fx_rates').upsert(
        { base, quote, rate: fetched.rate, rate_date: on, source: `${fetched.source} (${fetched.rateDate})` },
        { onConflict: 'base,quote,rate_date' },
      )
    }
    return fetched
  }

  // Last resort: the most recent rate we already hold that is not in the
  // future relative to the spend date.
  const { data: earlier } = await db
    .from('fx_rates')
    .select('rate, rate_date, source')
    .eq('base', base)
    .eq('quote', quote)
    .lte('rate_date', on)
    .order('rate_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (earlier) {
    return {
      rate: Number(earlier.rate),
      rateDate: earlier.rate_date,
      source: earlier.source ?? 'cache',
    }
  }

  return null
}

async function fetchRate(base: string, quote: string, on: DateOnly): Promise<Quote | null> {
  const url = `${ENDPOINT}/${on}?base=${encodeURIComponent(base)}&symbols=${encodeURIComponent(quote)}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) return null

    const body = (await response.json()) as {
      date?: string
      rates?: Record<string, number>
    }
    const rate = body.rates?.[quote]
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return null

    return { rate, rateDate: body.date ?? on, source: 'frankfurter/ecb' }
  } finally {
    clearTimeout(timer)
  }
}

/** ISO 4217, uppercase. The database enforces this too; this is the early no. */
export function assertCurrency(code: unknown): string {
  if (typeof code !== 'string' || !/^[A-Za-z]{3}$/.test(code)) {
    throw new AppError('That is not a currency code.', { kind: 'validation', retryable: false })
  }
  return code.toUpperCase()
}
