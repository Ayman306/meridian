/**
 * The two upstream providers, and the guard that stops them bankrupting us.
 *
 * Server-only. Both keys are plain `process.env` reads with no `NEXT_PUBLIC_`
 * prefix, which is non-negotiable #2: a key in the browser bundle is a key
 * that has been published.
 *
 * Everything here returns a result object rather than throwing, so a provider
 * being down, unconfigured, or over quota all arrive at the caller as the same
 * shape — one that degrades a field group and never fails a request.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

export type Provider = 'aerodatabox' | 'opensky'

/** Monthly for AeroDataBox, daily for OpenSky, per spec 9.1. */
export const LIMITS: Record<Provider, number> = {
  aerodatabox: 600,
  opensky: 4000,
}

/** Above this share of the allowance, serve cache and say so (spec 9.4). */
export const QUOTA_CEILING = 0.9

export interface ProviderResult<T> {
  ok: boolean
  data: T | null
  /** Why it did not happen. Becomes a user-visible notice, so keep it plain. */
  reason: string | null
  /** Whether the failure was a quota refusal rather than an upstream problem. */
  quota: boolean
}

const skipped = <T>(reason: string, quota = false): ProviderResult<T> => ({
  ok: false,
  data: null,
  reason,
  quota,
})

type Client = SupabaseClient<Database>

/**
 * Run a provider call if the allowance permits, and record what it cost.
 *
 * The usage number comes from the database rather than a counter in memory:
 * this runs in a serverless function that may be a different instance on every
 * request, and a counter that resets on cold start is not a budget.
 */
export async function withQuota<T>(
  admin: Client,
  provider: Provider,
  flightId: string | null,
  fn: () => Promise<T>,
): Promise<ProviderResult<T>> {
  const { data: used, error } = await admin.rpc('api_usage_in_window', {
    target_provider: provider,
  })

  if (error) {
    // Cannot prove we are under the limit, so assume we are not. The cost of
    // being wrong in the other direction is a burned monthly allowance.
    return skipped(`Could not check the ${provider} allowance.`, true)
  }

  if ((used ?? 0) >= LIMITS[provider] * QUOTA_CEILING) {
    return skipped(
      provider === 'aerodatabox'
        ? 'Live updates paused — the monthly data allowance is nearly used up.'
        : 'Live positions paused — the daily allowance is nearly used up.',
      true,
    )
  }

  try {
    const data = await fn()
    await record(admin, provider, flightId, true, null)
    return { ok: true, data, reason: null, quota: false }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await record(admin, provider, flightId, false, message)
    return skipped(`${provider} did not answer.`)
  }
}

async function record(
  admin: Client,
  provider: Provider,
  flightId: string | null,
  success: boolean,
  error: string | null,
) {
  // A failed call still consumed a unit at the provider, so it is still spend.
  await admin.from('api_usage').insert({
    provider,
    flight_id: flightId,
    units: 1,
    success,
    error,
  })
}

export async function usageFor(admin: Client, provider: Provider): Promise<number> {
  const { data } = await admin.rpc('api_usage_in_window', { target_provider: provider })
  return data ?? 0
}

// ---------------------------------------------------------------------------
// AeroDataBox — schedule, gate, terminal, delay, status
// ---------------------------------------------------------------------------

export interface StatusPayload {
  callsign: string | null
  registration: string | null
  aircraftType: string | null
  airlineIata: string | null
  airlineName: string | null
  originIata: string | null
  originName: string | null
  originTz: string | null
  destIata: string | null
  destName: string | null
  destTz: string | null
  scheduledDeparture: string | null
  estimatedDeparture: string | null
  actualDeparture: string | null
  scheduledArrival: string | null
  estimatedArrival: string | null
  actualArrival: string | null
  gate: string | null
  terminal: string | null
  baggageBelt: string | null
  status: string | null
  raw: unknown
}

export function aerodataboxConfigured(): boolean {
  return Boolean(process.env.AERODATABOX_API_KEY)
}

/**
 * One flight, one date, one unit of allowance.
 *
 * Called on save to resolve the route and cache the callsign, then only when
 * the phase's max-age says the cached copy is too old.
 */
export async function fetchStatus(
  flightNumber: string,
  date: string,
): Promise<StatusPayload> {
  const key = process.env.AERODATABOX_API_KEY
  if (!key) throw new Error('AERODATABOX_API_KEY is not set')

  const url = `https://aerodatabox.p.rapidapi.com/flights/number/${encodeURIComponent(flightNumber)}/${date}?withAircraftImage=false&withLocation=false`

  const res = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    headers: {
      'X-RapidAPI-Key': key,
      'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com',
    },
  })

  if (res.status === 404) throw new Error('Flight not found for that date')
  if (!res.ok) throw new Error(`AeroDataBox ${res.status}`)

  const body = (await res.json()) as unknown
  const leg = Array.isArray(body) ? body[0] : body
  if (!leg) throw new Error('AeroDataBox returned nothing')

  return normaliseStatus(leg as Record<string, never>)
}

/** Their shape to ours. Every field optional, because in practice they are. */
function normaliseStatus(leg: Record<string, never>): StatusPayload {
  const pick = (obj: unknown, ...path: string[]): unknown => {
    let value: unknown = obj
    for (const key of path) {
      if (!value || typeof value !== 'object') return null
      value = (value as Record<string, unknown>)[key]
    }
    return value ?? null
  }

  const str = (value: unknown): string | null => (typeof value === 'string' ? value : null)

  return {
    callsign: str(pick(leg, 'callSign')),
    registration: str(pick(leg, 'aircraft', 'reg')),
    aircraftType: str(pick(leg, 'aircraft', 'model')),
    airlineIata: str(pick(leg, 'airline', 'iata')),
    airlineName: str(pick(leg, 'airline', 'name')),
    originIata: str(pick(leg, 'departure', 'airport', 'iata')),
    originName: str(pick(leg, 'departure', 'airport', 'name')),
    originTz: str(pick(leg, 'departure', 'airport', 'timeZone')),
    destIata: str(pick(leg, 'arrival', 'airport', 'iata')),
    destName: str(pick(leg, 'arrival', 'airport', 'name')),
    destTz: str(pick(leg, 'arrival', 'airport', 'timeZone')),
    scheduledDeparture: str(pick(leg, 'departure', 'scheduledTime', 'utc')),
    estimatedDeparture: str(pick(leg, 'departure', 'predictedTime', 'utc')),
    actualDeparture: str(pick(leg, 'departure', 'actualTime', 'utc')),
    scheduledArrival: str(pick(leg, 'arrival', 'scheduledTime', 'utc')),
    estimatedArrival: str(pick(leg, 'arrival', 'predictedTime', 'utc')),
    actualArrival: str(pick(leg, 'arrival', 'actualTime', 'utc')),
    gate: str(pick(leg, 'departure', 'gate')),
    terminal: str(pick(leg, 'departure', 'terminal')),
    baggageBelt: str(pick(leg, 'arrival', 'baggageBelt')),
    status: str(pick(leg, 'status')),
    raw: leg,
  }
}

/** AeroDataBox's own words to our phase vocabulary. */
export function mapProviderStatus(status: string | null): string | null {
  if (!status) return null
  const value = status.toLowerCase()
  if (value.includes('cancel')) return 'cancelled'
  if (value.includes('divert')) return 'diverted'
  if (value.includes('arrived') || value.includes('landed')) return 'landed'
  if (value.includes('enroute') || value.includes('en route')) return 'enroute'
  if (value.includes('boarding')) return 'boarding'
  if (value.includes('departed')) return 'departed'
  return null
}

// ---------------------------------------------------------------------------
// OpenSky — live position
// ---------------------------------------------------------------------------

export interface PositionPayload {
  icao24: string
  lat: number
  lng: number
  altitudeM: number | null
  heading: number | null
  velocityMs: number | null
  verticalRate: number | null
  onGround: boolean
  recordedAt: string
}

export function openskyConfigured(): boolean {
  return Boolean(process.env.OPENSKY_CLIENT_ID && process.env.OPENSKY_CLIENT_SECRET)
}

/**
 * The OAuth token, cached in module scope.
 *
 * Spec 9.14 asks for exactly this: fetching a token per request would double
 * every position call and burn the daily credits on authentication. Module
 * scope survives between invocations on a warm instance and is simply refetched
 * on a cold one, which is the correct behaviour either way.
 */
let cachedToken: { value: string; expiresAt: number } | null = null

async function openskyToken(): Promise<string> {
  const id = process.env.OPENSKY_CLIENT_ID
  const secret = process.env.OPENSKY_CLIENT_SECRET
  if (!id || !secret) throw new Error('OpenSky credentials are not set')

  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.value

  const res = await fetch(
    'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token',
    {
      method: 'POST',
      signal: AbortSignal.timeout(8000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: id,
        client_secret: secret,
      }),
    },
  )

  if (!res.ok) throw new Error(`OpenSky auth ${res.status}`)
  const body = (await res.json()) as { access_token?: string; expires_in?: number }
  if (!body.access_token) throw new Error('OpenSky auth returned no token')

  cachedToken = {
    value: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 1800) * 1000,
  }
  return cachedToken.value
}

/**
 * Find an aircraft by callsign, or by hex once we have learned it.
 *
 * State vectors come back as arrays and are read **by index**, which spec 9.14
 * calls out explicitly — OpenSky's response has no keys, and guessing at
 * property names produces silent undefineds rather than an error.
 *
 *   0 icao24 · 1 callsign · 5 longitude · 6 latitude · 7 baro altitude
 *   8 on_ground · 9 velocity · 10 true_track · 11 vertical_rate
 *   3 time_position
 */
export async function fetchPosition(
  callsign: string | null,
  icao24: string | null,
): Promise<PositionPayload | null> {
  if (!callsign && !icao24) return null

  const token = await openskyToken()
  const url = new URL('https://opensky-network.org/api/states/all')
  if (icao24) url.searchParams.set('icao24', icao24.toLowerCase())

  const res = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!res.ok) throw new Error(`OpenSky ${res.status}`)
  const body = (await res.json()) as { states?: unknown[][]; time?: number }
  const states = body.states ?? []

  const wanted = callsign?.trim().toUpperCase()
  const match = icao24
    ? states[0]
    : states.find((s) => String(s[1] ?? '').trim().toUpperCase() === wanted)

  if (!match) return null

  const lng = num(match[5])
  const lat = num(match[6])
  if (lat === null || lng === null) return null

  const at = num(match[3]) ?? body.time ?? Math.floor(Date.now() / 1000)

  return {
    icao24: String(match[0] ?? '').trim(),
    lat,
    lng,
    altitudeM: num(match[7]),
    heading: num(match[10]),
    velocityMs: num(match[9]),
    verticalRate: num(match[11]),
    onGround: Boolean(match[8]),
    recordedAt: new Date(at * 1000).toISOString(),
  }
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
