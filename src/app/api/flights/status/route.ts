/**
 * POST /api/flights/status — the batched refresh the live view calls.
 *
 * The client sends every flight it can see, once a minute, and this decides
 * what actually goes out to the providers. Spec 9.4's acceptance test is the
 * design constraint: an hour with the module open on an upcoming flight must
 * cost at most two AeroDataBox calls, and both partners watching at once must
 * cost one call, not two.
 *
 * That falls out of putting the decision here rather than in the browser. Two
 * clients hitting this within a max-age window find the row already fresh, so
 * the second one pays nothing and reads what the first fetched.
 */
import { NextResponse } from 'next/server'
import { createAdminSupabase, createServerSupabase, requireUser } from '@/lib/supabase/server'
import { refreshFlight, latestPosition } from '@/lib/flights/orchestrator'
import { toAppError } from '@/lib/errors'
import type { FlightRow } from '@/modules/flights/types'

export const dynamic = 'force-dynamic'

/** One request cannot ask for the whole database. */
const MAX_FLIGHTS = 20

export async function POST(request: Request) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as { flightIds?: unknown } | null
  const ids = Array.isArray(body?.flightIds)
    ? body.flightIds.filter((id): id is string => typeof id === 'string').slice(0, MAX_FLIGHTS)
    : []

  if (ids.length === 0) return NextResponse.json({ flights: [], positions: [], notices: [] })

  try {
    // Read as the caller so RLS decides which flights they may see. Only the
    // provider calls and writes use the admin client, and only for rows this
    // read already proved they can reach.
    const supabase = await createServerSupabase()
    const { data: visible, error } = await supabase.from('flights').select('*').in('id', ids)
    if (error) throw error

    const flights = (visible ?? []) as FlightRow[]
    if (flights.length === 0) return NextResponse.json({ flights: [], positions: [], notices: [] })

    const admin = createAdminSupabase()
    const now = new Date()

    // Settled, never rejected: one flight failing must not blank the others.
    const outcomes = await Promise.allSettled(
      flights.map((flight) => refreshFlight(admin, flight, now)),
    )

    const rows: FlightRow[] = []
    const positions = []
    const notices = new Set<string>()

    for (let i = 0; i < outcomes.length; i++) {
      const outcome = outcomes[i]
      if (outcome?.status === 'fulfilled') {
        rows.push(outcome.value.flight)
        if (outcome.value.position) positions.push(outcome.value.position)
        for (const notice of outcome.value.notices) notices.add(notice)
      } else {
        // Fall back to what is stored. A stale row renders fine; a missing one
        // makes the screen flicker between having a flight and not.
        const flight = flights[i]!
        rows.push(flight)
        const stored = await latestPosition(admin, flight.id).catch(() => null)
        if (stored) positions.push(stored)
      }
    }

    return NextResponse.json({ flights: rows, positions, notices: [...notices] })
  } catch (e) {
    const err = toAppError(e)
    console.error('flight status refresh failed', err.kind, err.code, err.cause)
    // Even total failure answers with a shape the client can render. The live
    // view has no error state by design (spec 9.5) — it falls back to what it
    // already has in the query cache.
    return NextResponse.json(
      { flights: [], positions: [], notices: ['Live updates are unavailable right now.'] },
      { status: 200 },
    )
  }
}
