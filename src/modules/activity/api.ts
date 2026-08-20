'use client'

import { supabase } from '@/lib/supabase/client'
import { toAppError, unwrapList } from '@/lib/errors'
import type { Activity, ActivityEvent, Integration } from './types'

/** The feed, newest first. One round trip for ten tables. */
export async function listActivity(since: string | null, limit = 50): Promise<Activity[]> {
  const { data, error } = await supabase.rpc('activity_feed', {
    since,
    max_results: limit,
  })
  if (error) throw toAppError(error)

  return (data ?? []).map((row) => ({
    event: row.event as ActivityEvent,
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    actorId: row.actor_id,
    tripId: row.trip_id,
    at: row.at,
  }))
}

/**
 * Move this person's "new since" line to now.
 *
 * Their own row, their own marker — `user_settings` is `user_id = auth.uid()`,
 * so marking yours cannot touch theirs.
 */
export async function markActivitySeen(userId: string): Promise<void> {
  const { error } = await supabase
    .from('user_settings')
    .update({ activity_seen_at: new Date().toISOString() })
    .eq('user_id', userId)
  if (error) throw toAppError(error)
}

// ---------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------

export async function listIntegrations(coupleId: string): Promise<Integration[]> {
  const rows = unwrapList(
    await supabase
      .from('integrations')
      // Named columns rather than `*`: the secret is revoked at the column
      // level, and a `*` would be asking for something the grant refuses.
      .select('id, name, url, events, enabled, last_status, last_error, last_delivered_at')
      .eq('couple_id', coupleId)
      .order('created_at'),
  )

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    url: row.url,
    events: row.events as ActivityEvent[],
    enabled: row.enabled,
    lastStatus: row.last_status,
    lastError: row.last_error,
    lastDeliveredAt: row.last_delivered_at,
  }))
}

/**
 * Add a webhook, and hand back its signing secret once.
 *
 * Generated in the browser with the platform's own CSPRNG, for the same reason
 * access tokens are: the value never has to travel from a server that could log
 * it, and the database refuses to give it back afterwards. If it is lost, the
 * integration is replaced rather than recovered.
 */
export async function addIntegration(
  coupleId: string,
  userId: string,
  input: { name: string; url: string; events: ActivityEvent[] },
): Promise<{ secret: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  const secret = `whsec_${btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '')}`

  const { error } = await supabase.from('integrations').insert({
    couple_id: coupleId,
    created_by: userId,
    name: input.name,
    url: input.url,
    events: input.events,
    secret,
  })
  if (error) throw toAppError(error)

  return { secret }
}

export async function setIntegrationEnabled(id: string, enabled: boolean): Promise<void> {
  const { error } = await supabase.from('integrations').update({ enabled }).eq('id', id)
  if (error) throw toAppError(error)
}

export async function removeIntegration(id: string): Promise<void> {
  const { error } = await supabase.from('integrations').delete().eq('id', id)
  if (error) throw toAppError(error)
}
