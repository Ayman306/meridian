/**
 * One call that answers "what is going on".
 *
 * Exists because the alternative is four round-trips to reconstruct the same
 * picture, and a model that has to make four calls before it can say anything
 * often makes three and guesses the fourth.
 *
 * It leans on the `dashboard()` RPC the app's home screen already uses, so the
 * assistant and the screen cannot drift apart in what they think is next.
 * SECURITY DEFINER, but scoped by `is_couple_member` inside — the same function
 * the browser calls, with the same result.
 */
import { z } from 'zod'
import { defineTool, requireCouple } from './types'
import type { AnyTool } from './types'

const getOverview = defineTool({
  name: 'get_overview',
  module: 'trips',
  title: 'Get an overview',
  description:
    'A single summary of what is current: the next trip, what is coming up, and anything needing attention. Call this first when asked an open question like "what is happening" — it saves four separate lookups.',
  readOnly: true,
  inputSchema: z.object({}),
  async handler(ctx) {
    requireCouple(ctx)

    const { data, error } = await ctx.supabase.rpc('dashboard')
    if (error) throw new Error(error.message)
    if (!data) return 'Nothing to report yet.'

    // Returned as JSON rather than prose: the shape comes from the RPC and is
    // not this tool's to decide, and inventing a narrative around fields that
    // may change is how a summary starts lying.
    return [
      'Current state, as the app itself computes it:',
      '',
      JSON.stringify(data, null, 2),
    ].join('\n')
  },
})

export const dashboardTools: AnyTool[] = [getOverview]
