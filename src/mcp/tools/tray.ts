/**
 * The suggestion tray, from the other side.
 *
 * `suggest_itinerary` puts drafts in. This reads them back and, when somebody
 * says so, dismisses one.
 *
 * There is deliberately **no accept tool**. Accepting is the human step the
 * whole tray exists to preserve (non-negotiable #5) — an assistant that could
 * both write a draft and accept it has a direct write to the itinerary with two
 * extra steps, which is worse than an honest direct write because it looks
 * reviewed. Accepting happens in the app, by a person, looking at it.
 *
 * Dismissing is allowed because the failure mode is harmless: the worst case is
 * a suggestion nobody wanted going away, and it changes no plan.
 */
import { z } from 'zod'
import type { TrayDraft } from '@/types/domain'
import { defineTool, requireCouple } from './types'
import type { AnyTool } from './types'

const listSuggestions = defineTool({
  name: 'list_suggestions',
  module: 'trips',
  title: 'List pending suggestions',
  description:
    'Drafts waiting in a trip’s suggestion tray — including ones you put there. Use this to check whether a plan you proposed has been accepted yet. You cannot accept them: that is done by a person in the app, on purpose.',
  readOnly: true,
  inputSchema: z.object({
    trip_id: z.string().uuid().describe('From list_trips.'),
  }),
  async handler(ctx, input) {
    requireCouple(ctx)

    const { data, error } = await ctx.supabase
      .from('suggestion_tray')
      .select('id, payload, source, generated_at')
      .eq('trip_id', input.trip_id)
      .is('accepted_at', null)
      .is('dismissed_at', null)
      .order('generated_at', { ascending: false })
    if (error) throw new Error(error.message)

    const rows = data ?? []
    if (rows.length === 0) return 'Nothing waiting in the tray for this trip.'

    return rows
      .map((row) => {
        // jsonb, so parsed defensively — the shape is written down in one place
        // and nothing stops an older row being a different one.
        const draft = row.payload as unknown as Partial<TrayDraft> | null
        const days = Array.isArray(draft?.days) ? draft.days : []
        const items = days.reduce((sum, day) => sum + (day.items?.length ?? 0), 0)
        const parts = [
          `${items} item${items === 1 ? '' : 's'} across ${days.length} day${days.length === 1 ? '' : 's'}`,
          `from ${row.source ?? 'unknown'}`,
          row.generated_at.slice(0, 10),
        ]
        if (draft?.note) parts.push(`— ${draft.note}`)
        return `- ${parts.join(' · ')} (${row.id})`
      })
      .join('\n')
  },
})

const dismissSuggestion = defineTool({
  name: 'dismiss_suggestion',
  module: 'trips',
  title: 'Dismiss a suggestion',
  description:
    'Clear a draft out of the tray when the person has said they do not want it. This changes no plan — it only removes a proposal nobody kept. There is no matching accept tool: accepting is a person’s job.',
  readOnly: false,
  inputSchema: z.object({
    suggestion_id: z.string().uuid().describe('From list_suggestions.'),
  }),
  async handler(ctx, input) {
    requireCouple(ctx)

    const { data, error } = await ctx.supabase
      .from('suggestion_tray')
      .update({ dismissed_at: new Date().toISOString() })
      .eq('id', input.suggestion_id)
      .is('accepted_at', null)
      .is('dismissed_at', null)
      .select('id')
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return 'No pending suggestion with that id — it may already have been accepted or dismissed.'

    return 'Dismissed. Nothing on the itinerary changed.'
  },
})

export const trayTools: AnyTool[] = [listSuggestions, dismissSuggestion]
