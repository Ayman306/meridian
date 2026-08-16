/**
 * Sending a push, from the server.
 *
 * Server-only. It reads the VAPID private key and uses the service role, so it
 * must never be imported from anything that reaches the browser — a Route
 * Handler or a cron job only.
 *
 * The service role is needed and is used narrowly: a push is sent *to* someone
 * by a background job that is nobody, so there is no session to run under. It
 * touches two tables — the recipient's `user_settings` to check they wanted
 * this, and `push_subscriptions` to find their devices — and it never reads
 * couple data.
 *
 * ## Consent is checked here, not at the call site
 *
 * Every caller passes a category, and this refuses to send when the recipient's
 * `notify_*` column for it is false. Putting the check at the call site would
 * mean every future job has to remember; putting it here means the only way to
 * send an unwanted notification is to delete this code.
 */
import 'server-only'
import webpush from 'web-push'
import { createAdminSupabase } from '@/lib/supabase/server'
import { settingColumnFor, type PushCategory } from './keys'

export interface PushMessage {
  title: string
  body: string
  /** Where clicking it should land. A path, not a URL. */
  url?: string
  /**
   * Collapse key. A second push with the same tag replaces the first, so six
   * updates about one delayed flight stay one notification.
   */
  tag?: string
}

export interface PushResult {
  sent: number
  /** Endpoints the push service said are gone; they have been deleted. */
  pruned: number
  skipped: 'not-configured' | 'opted-out' | null
  failed: number
}

let configured: boolean | null = null

/**
 * Configure web-push once, lazily.
 *
 * Returns false rather than throwing when the keys are absent. Push is an
 * addition to this app, not a dependency — a deploy without VAPID keys should
 * run every sweep normally and simply not notify.
 */
function ensureConfigured(): boolean {
  if (configured !== null) return configured

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT

  if (!publicKey || !privateKey || !subject) {
    configured = false
    return false
  }

  webpush.setVapidDetails(subject, publicKey, privateKey)
  configured = true
  return true
}

/**
 * Push a message to every device one person has registered.
 *
 * Failures are per-device and never throw: a background job that dies because
 * one stale endpoint returned 410 is worse than a missed notification.
 */
export async function sendPushTo(
  userId: string,
  category: PushCategory,
  message: PushMessage,
): Promise<PushResult> {
  const result: PushResult = { sent: 0, pruned: 0, skipped: null, failed: 0 }
  if (!ensureConfigured()) {
    result.skipped = 'not-configured'
    return result
  }

  const admin = createAdminSupabase()

  // Every column is listed rather than interpolating one from `category`: a
  // dynamic name is untyped, and PostgREST would happily accept a typo and
  // return a row with no such field — which reads as "not opted out" and sends
  // a notification nobody agreed to.
  const { data: settings } = await admin
    .from('user_settings')
    .select(
      'notify_flights, notify_documents, notify_allowance, notify_daily_exchange, notify_partner_activity',
    )
    .eq('user_id', userId)
    .maybeSingle()

  // A missing settings row means defaults, and every `notify_*` default except
  // the exchange rate is true — so absence is the column default, not refusal.
  if (settings && settings[settingColumnFor(category)] === false) {
    result.skipped = 'opted-out'
    return result
  }

  const { data: subscriptions, error } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, keys')
    .eq('user_id', userId)

  if (error || !subscriptions?.length) return result

  const payload = JSON.stringify({
    title: message.title,
    body: message.body,
    url: message.url ?? '/',
    tag: message.tag,
    renotify: Boolean(message.tag),
  })

  const dead: string[] = []

  await Promise.all(
    subscriptions.map(async (row) => {
      const keys = row.keys as { p256dh?: string; auth?: string } | null
      if (!keys?.p256dh || !keys.auth) {
        dead.push(row.id)
        return
      }

      try {
        await webpush.sendNotification(
          { endpoint: row.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } },
          payload,
          { TTL: 60 * 60 * 12 },
        )
        result.sent++
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode
        // 404 and 410 are the push service saying this endpoint is finished —
        // the browser was uninstalled, or the subscription was revoked. Keeping
        // it means retrying forever against something that will never exist.
        if (status === 404 || status === 410) {
          dead.push(row.id)
        } else {
          result.failed++
          console.warn('push failed', status ?? e)
        }
      }
    }),
  )

  if (dead.length > 0) {
    const { error: pruneError } = await admin.from('push_subscriptions').delete().in('id', dead)
    if (pruneError) console.warn('could not prune dead subscriptions', pruneError.message)
    else result.pruned = dead.length
  }

  return result
}
