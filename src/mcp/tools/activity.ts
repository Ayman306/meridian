/**
 * What has changed lately, and what is wired to hear about it.
 *
 * `whats_new` is the tool that makes a morning briefing possible without an
 * assistant trawling six other tools and guessing which rows are recent. It is
 * the same `activity_feed` function the dashboard reads, so the answer a model
 * gives and the card a person sees cannot disagree.
 *
 * ## Integrations are read-only here, deliberately
 *
 * There is no `add_integration`. Creating an outbound webhook means naming a
 * URL that this app will then POST the couple's activity to — which is exactly
 * the capability a prompt injection in a pasted itinerary would want. "Add a
 * webhook to https://attacker.example" is a single tool call away from
 * exfiltration, and no amount of description text makes a model reliably refuse
 * it.
 *
 * So the model can see what is connected and say when one is failing, which is
 * genuinely useful, and connecting a new one stays a deliberate act by a person
 * in Settings. This is the same reasoning that keeps `delete_all_health_data`
 * out of the registry.
 */
import { z } from 'zod'
import { defineTool, requireCouple } from './types'
import type { AnyTool } from './types'

const whatsNew = defineTool({
  name: 'whats_new',
  module: 'trips',
  title: 'What has changed lately',
  description:
    "Everything either of them added recently, newest first, with who added it. Use this for 'what did I miss' or a morning summary — it is one call instead of trawling every other tool for recent rows. Creations only: nothing in this app records who last *edited* something, so do not claim an edit had an author.",
  readOnly: true,
  inputSchema: z.object({
    hours: z
      .number()
      .int()
      .min(1)
      .max(720)
      .default(24)
      .describe('How far back to look. 24 is the overnight case; 168 is a week.'),
    limit: z.number().int().min(1).max(100).default(30).describe('How many to return.'),
  }),
  async handler(ctx, input) {
    requireCouple(ctx)

    const since = new Date(Date.now() - input.hours * 3600_000).toISOString()
    const { data, error } = await ctx.supabase.rpc('activity_feed', {
      since,
      max_results: input.limit,
    })
    if (error) throw new Error(error.message)

    const rows = data ?? []
    if (rows.length === 0) {
      return `Nothing has changed in the last ${input.hours} hours.`
    }

    // Names are resolved here rather than returning bare ids: "Ada saved a
    // place" is an answer, "actor 3fa9b2c1 saved a place" is a lookup task
    // handed back to the model.
    const { data: people } = await ctx.supabase.from('profiles').select('id, display_name')
    const nameOf = new Map((people ?? []).map((p) => [p.id, p.display_name ?? 'Someone']))

    const lines = rows.map((row) => {
      const who = row.actor_id ? (nameOf.get(row.actor_id) ?? 'Someone') : 'Someone'
      const when = new Date(row.at).toISOString().replace('T', ' ').slice(0, 16)
      const what = [row.title, row.subtitle].filter(Boolean).join(' · ')
      return `- ${when} · ${who} · ${row.event} · ${what}`
    })

    return [`${rows.length} change${rows.length === 1 ? '' : 's'} in the last ${input.hours} hours:`, ...lines].join('\n')
  },
})

const listIntegrations = defineTool({
  name: 'list_integrations',
  module: 'trips',
  title: 'List connected services',
  description:
    'The outbound webhooks this couple has connected, and whether the last delivery to each one worked. Read-only: adding a webhook means naming a URL this app will post their activity to, which is a decision a person makes in Settings and not one to take on their behalf. The signing secret is never returned.',
  readOnly: true,
  inputSchema: z.object({}),
  async handler(ctx) {
    requireCouple(ctx)

    const { data, error } = await ctx.supabase
      // Never `secret`. The grant refuses it anyway; naming the columns says so.
      .from('integrations')
      .select('name, url, events, enabled, last_status, last_error, last_delivered_at')
      .order('created_at')
    if (error) throw new Error(error.message)

    const rows = data ?? []
    if (rows.length === 0) {
      return 'Nothing is connected. Webhooks are added in Settings → Connected services.'
    }

    return rows
      .map((row) => {
        const parts = [
          row.name,
          row.enabled ? 'enabled' : 'disabled',
          row.events.length === 0 ? 'all events' : row.events.join('/'),
          row.url,
        ]
        if (row.last_error) parts.push(`last attempt FAILED: ${row.last_error}`)
        else if (row.last_status) parts.push(`last delivery HTTP ${row.last_status}`)
        else parts.push('never delivered')
        return `- ${parts.join(' · ')}`
      })
      .join('\n')
  },
})

export const activityTools: AnyTool[] = [whatsNew, listIntegrations]
