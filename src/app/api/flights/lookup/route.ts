/**
 * POST /api/flights/lookup — resolve a flight number and date on save.
 *
 * Spec 9.8: one call, once per flight ever, which buys the airline, the route,
 * both timezones and the callsign that makes position tracking possible. One
 * unit of a 600-a-month allowance is a good trade for all of that.
 *
 * If it cannot be resolved the caller saves anyway with manual times and
 * `phase = 'unknown'`. Manual entry is the baseline, not the fallback — this
 * endpoint is an accelerator and is allowed to fail.
 */
import { NextResponse } from 'next/server'
import { createAdminSupabase, requireUser } from '@/lib/supabase/server'
import { aerodataboxConfigured, fetchStatus, withQuota } from '@/lib/flights/providers'
import { normaliseFlightNumber, toCallsign } from '@/modules/flights/logic'
import { isValidDateOnly } from '@/lib/dates'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as {
    flightNumber?: unknown
    date?: unknown
  } | null

  const flightNumber =
    typeof body?.flightNumber === 'string' ? normaliseFlightNumber(body.flightNumber) : ''
  const date = typeof body?.date === 'string' ? body.date : ''

  if (!flightNumber || !isValidDateOnly(date)) {
    return NextResponse.json({ error: 'Send a flight number and a date.' }, { status: 400 })
  }

  const admin = createAdminSupabase()

  // The callsign comes from our own table and costs nothing, so it is worth
  // returning even when the lookup itself is unavailable — position tracking
  // can work on a manually entered flight.
  const iata = flightNumber.match(/^([A-Z0-9]{2,3}?)\d/)?.[1] ?? null
  const { data: airline } = iata
    ? await admin.from('airline_codes').select('*').eq('iata', iata).maybeSingle()
    : { data: null }

  const fallback = {
    resolved: false as const,
    flightNumber,
    callsign: toCallsign(flightNumber, airline?.icao ?? null),
    airlineIata: airline?.iata ?? iata,
    airlineName: airline?.name ?? null,
  }

  if (!aerodataboxConfigured()) {
    return NextResponse.json({
      ...fallback,
      notice: 'No flight-data key configured — enter the times by hand.',
    })
  }

  const result = await withQuota(admin, 'aerodatabox', null, () => fetchStatus(flightNumber, date))

  if (!result.ok || !result.data) {
    return NextResponse.json({ ...fallback, notice: result.reason })
  }

  const s = result.data
  return NextResponse.json({
    resolved: true,
    flightNumber,
    // Theirs if they gave one, ours otherwise.
    callsign: s.callsign ?? fallback.callsign,
    registration: s.registration,
    aircraftType: s.aircraftType,
    airlineIata: s.airlineIata ?? fallback.airlineIata,
    airlineName: s.airlineName ?? fallback.airlineName,
    originIata: s.originIata,
    originName: s.originName,
    originTz: s.originTz,
    destIata: s.destIata,
    destName: s.destName,
    destTz: s.destTz,
    scheduledDeparture: s.scheduledDeparture,
    scheduledArrival: s.scheduledArrival,
    estimatedDeparture: s.estimatedDeparture,
    estimatedArrival: s.estimatedArrival,
    gate: s.gate,
    terminal: s.terminal,
  })
}
