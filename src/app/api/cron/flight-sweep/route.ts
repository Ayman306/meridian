/**
 * POST /api/cron/flight-sweep — the background half of the flight engine.
 *
 * Two jobs, in this order.
 *
 * First the hard stop: `deactivate_finished_flights()` switches off tracking
 * for anything landed, cancelled, or six hours past its scheduled arrival with
 * nobody having noticed. This runs first deliberately — it is the guard
 * against one stuck flight quietly consuming the month, and it must happen
 * even if everything after it fails.
 *
 * Then the sweep itself, over flights in the window from six hours before
 * departure to landing. Same max-age rules as the on-demand path, so it costs
 * roughly twenty extra calls per flight and guarantees the watcher learns the
 * flight landed without having the app open (spec 9.8).
 */
import { NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase/server'
import { assertCronRequest } from '@/lib/cron'
import { refreshFlight } from '@/lib/flights/orchestrator'
import { toAppError } from '@/lib/errors'
import type { FlightRow } from '@/modules/flights/types'

export const dynamic = 'force-dynamic'

/** A ceiling, so a bad day cannot turn into a bad month. */
const MAX_PER_SWEEP = 12

export async function POST(request: Request) {
  try {
    assertCronRequest(request)
  } catch (e) {
    return NextResponse.json({ error: toAppError(e).message }, { status: 401 })
  }

  const admin = createAdminSupabase()
  const now = new Date()

  const { data: deactivated, error: sweepError } = await admin.rpc('deactivate_finished_flights')
  if (sweepError) {
    console.error('flight sweep: deactivation failed', sweepError.message)
  }

  // Only what is genuinely in play. A flight three weeks out has nothing to
  // report and polling it is pure spend.
  const from = new Date(now.getTime() - 12 * 60 * 60_000).toISOString()
  const to = new Date(now.getTime() + 6 * 60 * 60_000).toISOString()

  const { data: due, error } = await admin
    .from('flights')
    .select('*')
    .eq('tracking_active', true)
    .is('deleted_at', null)
    .lte('scheduled_departure', to)
    .gte('scheduled_arrival', from)
    .order('scheduled_departure')
    .limit(MAX_PER_SWEEP)

  if (error) {
    console.error('flight sweep: load failed', error.message)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  const flights = (due ?? []) as FlightRow[]
  const outcomes = await Promise.allSettled(
    flights.map((flight) => refreshFlight(admin, flight, now)),
  )

  let statusCalls = 0
  let positionCalls = 0
  let failed = 0

  for (const outcome of outcomes) {
    if (outcome.status !== 'fulfilled') {
      failed++
      continue
    }
    if (outcome.value.calls.status) statusCalls++
    if (outcome.value.calls.position) positionCalls++
  }

  return NextResponse.json({
    ok: true,
    deactivated: deactivated ?? 0,
    swept: flights.length,
    statusCalls,
    positionCalls,
    failed,
  })
}
