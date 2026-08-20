/**
 * POST /api/cron/webhook-sweep — push what changed to whatever else they use.
 *
 * The app deliberately knows nothing about Slack, Discord, Home Assistant, n8n
 * or IFTTT. It posts a signed JSON body to a URL somebody pasted, and whatever
 * is at the other end decides what that means. That single generic act is what
 * makes all of those reachable without a line of code each.
 *
 * ## Why a sweep rather than a database trigger
 *
 * `pg_net` could fire on insert, and the note in 0015 already explains why
 * giving the database an outbound HTTP call is a position worth being careful
 * about. A trigger would also fire inside the writing transaction, so a slow or
 * hostile endpoint would slow down — or fail — somebody saving a restaurant.
 *
 * A sweep is slower and cannot do either of those things.
 *
 * ## Three things that make this safe to point at a URL a person typed
 *
 *   1. **SSRF.** `assertPublicUrl` refuses loopback, link-local, private
 *      ranges, `.internal`, and the cloud metadata endpoint — the same guard
 *      the maps link resolver uses, including the IPv4-mapped IPv6 case that
 *      got through the first version of it. Redirects are not followed: a
 *      public URL that 302s to 169.254.169.254 is the whole attack.
 *   2. **Signing.** Every body carries an HMAC-SHA256 over `timestamp.body` in
 *      `X-Meridian-Signature`, so the receiver can prove it came from here and
 *      reject a replay. The secret is never readable back out of the database,
 *      even by its owner.
 *   3. **Bounded work.** One attempt per integration per sweep, a hard timeout,
 *      and a cap on how many events a single delivery carries. A failing
 *      endpoint costs a few seconds every fifteen minutes and never blocks
 *      anything a person is doing.
 *
 * ## Delivery semantics, stated plainly
 *
 * At-most-once, per sweep. `delivered_through` advances only on a 2xx, so a
 * failed delivery is retried on the next sweep with the same events. A receiver
 * that accepts and then crashes will miss those events — this is a notifier,
 * not a queue, and pretending otherwise would need a durable outbox nobody
 * asked for.
 */
import { NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase/server'
import { assertCronRequest } from '@/lib/cron'
import { toAppError } from '@/lib/errors'
import { assertPublicUrl } from '@/lib/net/publicUrl'
import { wantsEvent } from '@/modules/activity/logic'

export const dynamic = 'force-dynamic'

/** One slow endpoint must not hold the sweep open. */
const TIMEOUT_MS = 5_000
/** A quiet hour produces a handful; a bulk import should not produce a novel. */
const MAX_EVENTS_PER_DELIVERY = 50
/** How far back a brand-new integration looks on its first delivery. */
const FIRST_RUN_WINDOW_MS = 60 * 60 * 1000

export async function POST(request: Request) {
  try {
    assertCronRequest(request)
  } catch (e) {
    return NextResponse.json({ error: toAppError(e).message }, { status: 401 })
  }

  const admin = createAdminSupabase()

  // The secret is selected here and nowhere else. This is the one context that
  // needs it — the service role reads it to sign, and it never leaves.
  const { data: integrations, error } = await admin
    .from('integrations')
    .select('id, couple_id, url, events, secret, delivered_through')
    .eq('enabled', true)

  if (error) {
    console.error('webhook sweep: could not list integrations', error.message)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  let delivered = 0
  let failed = 0
  let skipped = 0

  for (const integration of integrations ?? []) {
    const since =
      integration.delivered_through ?? new Date(Date.now() - FIRST_RUN_WINDOW_MS).toISOString()

    // The feed function is SECURITY INVOKER, so calling it as the service role
    // would return nothing useful — RLS has no couple to key off. The events
    // are gathered here instead, scoped explicitly by couple_id, which is the
    // one place in this app where that is written by hand rather than enforced.
    const events = await gatherEvents(admin, integration.couple_id, since)
    const wanted = events
      .filter((e) => wantsEvent(integration.events, e.event))
      .slice(0, MAX_EVENTS_PER_DELIVERY)

    if (wanted.length === 0) {
      skipped += 1
      continue
    }

    const result = await deliver(integration.url, integration.secret, wanted)

    // `delivered_through` advances only on success, so a failure is retried
    // with the same events rather than silently skipping them.
    const patch = result.ok
      ? {
          delivered_through: wanted[0]!.at,
          last_status: result.status,
          last_error: null,
          last_delivered_at: new Date().toISOString(),
        }
      : {
          last_status: result.status,
          last_error: result.error.slice(0, 500),
          last_delivered_at: new Date().toISOString(),
        }

    await admin.from('integrations').update(patch).eq('id', integration.id)
    if (result.ok) delivered += 1
    else failed += 1
  }

  return NextResponse.json({ ok: true, delivered, failed, skipped })
}

interface FeedEvent {
  event: string
  id: string
  title: string
  subtitle: string | null
  actor_id: string | null
  trip_id: string | null
  at: string
}

/**
 * The same events the feed shows, for one couple.
 *
 * Only the tables a webhook has any business announcing. Documents are absent
 * deliberately: "a passport was added" going to a Discord channel is a fact
 * about somebody's paperwork leaving the app, and the person who set up the
 * webhook is not necessarily the person the document belongs to.
 */
async function gatherEvents(
  admin: ReturnType<typeof createAdminSupabase>,
  coupleId: string,
  since: string,
): Promise<FeedEvent[]> {
  const [items, saves, stays, expenses, flights] = await Promise.all([
    admin
      .from('itinerary_items')
      .select('id, title, place_name, proposed_by, trip_id, created_at')
      .eq('couple_id', coupleId)
      .is('deleted_at', null)
      .gt('created_at', since),
    admin
      .from('wishlist_items')
      .select('id, title, city, user_id, created_at')
      .eq('couple_id', coupleId)
      .is('deleted_at', null)
      .gt('created_at', since),
    admin
      .from('accommodations')
      .select('id, name, city, created_by, trip_id, created_at')
      .eq('couple_id', coupleId)
      .is('deleted_at', null)
      .gt('created_at', since),
    admin
      .from('expenses')
      .select('id, description, currency, amount, created_by, trip_id, created_at')
      .eq('couple_id', coupleId)
      .is('deleted_at', null)
      .gt('created_at', since),
    admin
      .from('flights')
      .select('id, flight_number, origin_iata, dest_iata, created_by, trip_id, created_at')
      .eq('couple_id', coupleId)
      .is('deleted_at', null)
      .gt('created_at', since),
  ])

  const events: FeedEvent[] = [
    ...(items.data ?? []).map((r) => ({
      event: 'plan_added',
      id: r.id,
      title: r.title,
      subtitle: r.place_name,
      actor_id: r.proposed_by,
      trip_id: r.trip_id,
      at: r.created_at,
    })),
    ...(saves.data ?? []).map((r) => ({
      event: 'place_saved',
      id: r.id,
      title: r.title,
      subtitle: r.city,
      actor_id: r.user_id,
      trip_id: null,
      at: r.created_at,
    })),
    ...(stays.data ?? []).map((r) => ({
      event: 'stay_booked',
      id: r.id,
      title: r.name,
      subtitle: r.city,
      actor_id: r.created_by,
      trip_id: r.trip_id,
      at: r.created_at,
    })),
    ...(expenses.data ?? []).map((r) => ({
      event: 'expense_logged',
      id: r.id,
      title: r.description,
      subtitle: `${r.currency} ${r.amount}`,
      actor_id: r.created_by,
      trip_id: r.trip_id,
      at: r.created_at,
    })),
    ...(flights.data ?? []).map((r) => ({
      event: 'flight_added',
      id: r.id,
      title: r.flight_number,
      subtitle: `${r.origin_iata ?? '???'} to ${r.dest_iata ?? '???'}`,
      actor_id: r.created_by,
      trip_id: r.trip_id,
      at: r.created_at,
    })),
  ]

  // Newest first, so `wanted[0].at` is the high-water mark to record.
  return events.sort((a, b) => b.at.localeCompare(a.at))
}

type DeliveryResult =
  | { ok: true; status: number }
  | { ok: false; status: number | null; error: string }

async function deliver(
  rawUrl: string,
  secret: string,
  events: FeedEvent[],
): Promise<DeliveryResult> {
  let url: URL
  try {
    url = new URL(rawUrl)
    assertPublicUrl(url)
  } catch (e) {
    return { ok: false, status: null, error: `refused: ${(e as Error).message}` }
  }

  const timestamp = Math.floor(Date.now() / 1000).toString()
  const body = JSON.stringify({
    source: 'meridian',
    delivered_at: new Date().toISOString(),
    events,
  })

  const signature = await sign(secret, `${timestamp}.${body}`)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Meridian/1.0 (+https://github.com/Ayman306/meridian)',
        'X-Meridian-Timestamp': timestamp,
        'X-Meridian-Signature': `sha256=${signature}`,
      },
      body,
      // A public URL that 302s to the metadata endpoint is the whole attack, so
      // a redirect is a refusal rather than something to follow and re-check.
      redirect: 'manual',
      signal: controller.signal,
    })

    if (response.status >= 300 && response.status < 400) {
      return { ok: false, status: response.status, error: 'endpoint redirected; not followed' }
    }
    if (!response.ok) {
      return { ok: false, status: response.status, error: `endpoint returned ${response.status}` }
    }
    return { ok: true, status: response.status }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { ok: false, status: null, error: message === 'The operation was aborted.' ? 'timed out' : message }
  } finally {
    clearTimeout(timer)
  }
}

/** HMAC-SHA256, hex. WebCrypto, so there is no node-only dependency here. */
async function sign(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
