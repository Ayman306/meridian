/**
 * Wellness tips — read them, and propose new ones for a person to keep.
 *
 * Part of the opt-in `health` grant, like everything under the health tab.
 *
 * ## An assistant proposes; a person keeps
 *
 * `propose_wellness_tip` writes a **draft**. It shows in the app under
 * "Waiting for you" and is not part of the guidance until one of the partners
 * keeps it (non-negotiable #5). Unlike the itinerary tray this is not only a
 * property of the tool surface: every call here carries an OAuth token with a
 * `client_id` claim, and `wellness_tips_guard` (0040) uses it to force an
 * assistant's insert to a draft and refuse any attempt to publish, edit or
 * remove a tip a person has kept. So there is no keep tool, and one could not
 * work if it were added.
 *
 * `withdraw_wellness_tip` takes back a draft that has not been kept — the
 * same harmless-by-construction reasoning as `dismiss_suggestion`.
 *
 * ## What this never touches
 *
 * The intimacy log. This file reads `wellness_tips` and nothing else, and
 * imports only the health module's pure `logic` — `registry.test.ts` fails on
 * anything more.
 */
import { z } from 'zod'
import {
  TIP_AUDIENCES,
  TIP_BODY_MAX,
  TIP_CATEGORIES,
  TIP_CATEGORY_LABELS,
  TIP_TITLE_MAX,
  isTipSourceUrl,
} from '@/modules/health/logic'
import { defineTool, requireCouple } from './types'
import type { AnyTool } from './types'

// From the arrays rather than `health/types`: this file may reach into the
// health module through its pure `logic` only.
type TipCategory = (typeof TIP_CATEGORIES)[number]
type TipAudience = (typeof TIP_AUDIENCES)[number]

const categories = TIP_CATEGORIES as [TipCategory, ...TipCategory[]]
const audiences = TIP_AUDIENCES as [TipAudience, ...TipAudience[]]

const DISCLAIMER =
  'General information, not medical advice. The linked page is the authority, not the tip.'

const listWellnessTips = defineTool({
  name: 'list_wellness_tips',
  module: 'health',
  title: 'List wellness tips',
  description:
    'The wellness guidance in the Health tab: the shared set every couple sees, the tips the two of them added, and any drafts waiting for one of you to keep. Each line says which it is. Use it before proposing a tip, so you do not suggest one that is already there.',
  readOnly: true,
  inputSchema: z.object({
    category: z
      .enum(categories)
      .optional()
      .describe(`Only one section: ${TIP_CATEGORIES.map((c) => `${c} (${TIP_CATEGORY_LABELS[c]})`).join(', ')}.`),
  }),
  async handler(ctx, input) {
    requireCouple(ctx)

    let query = ctx.supabase
      .from('wellness_tips')
      .select('id, couple_id, status, category, audience, title, body, source_url')
      .is('deleted_at', null)
      .order('category')
      .order('title')
    if (input.category) query = query.eq('category', input.category)

    const { data, error } = await query
    if (error) throw new Error(error.message)

    const rows = data ?? []
    if (rows.length === 0) return 'No tips in that section.'

    const lines = rows.map((row) => {
      const kind = row.couple_id === null ? 'shared' : row.status === 'draft' ? 'draft, waiting' : 'yours'
      const section = TIP_CATEGORY_LABELS[row.category as TipCategory] ?? row.category
      return `- [${kind}] ${row.title} — ${row.body} (${section} · for ${row.audience} · ${row.source_url}) (${row.id})`
    })
    return [...lines, '', DISCLAIMER].join('\n')
  },
})

const proposeWellnessTip = defineTool({
  name: 'propose_wellness_tip',
  module: 'health',
  title: 'Propose a wellness tip',
  description:
    'Suggest a tip for the Health tab’s wellness guidance. It is saved as a DRAFT and does NOT appear in their guidance: it waits under "Waiting for you" until one of them keeps it in the app, so tell them it is waiting rather than that it was added. A source link is required and must be the page the tip comes from — a public-health body (NHS, CDC, WHO or similar), never a shop or a supplement brand. Keep it general information, never a target for how often or how much.',
  readOnly: false,
  inputSchema: z.object({
    title: z.string().trim().min(1).max(TIP_TITLE_MAX).describe('Short, like "Deal with jet lag first".'),
    body: z.string().trim().min(1).max(TIP_BODY_MAX).describe('Two or three plain sentences.'),
    category: z.enum(categories).describe(TIP_CATEGORIES.map((c) => `${c} = ${TIP_CATEGORY_LABELS[c]}`).join('; ')),
    audience: z.enum(audiences).default('everyone').describe('Who it is for. Most tips are for everyone.'),
    source_url: z
      .string()
      .trim()
      .refine(isTipSourceUrl, 'A full https:// link to the page the tip comes from.')
      .describe('The page this is based on. Required.'),
  }),
  async handler(ctx, input) {
    const coupleId = requireCouple(ctx)

    const { data, error } = await ctx.supabase
      .from('wellness_tips')
      .insert({
        couple_id: coupleId,
        title: input.title,
        body: input.body,
        category: input.category,
        audience: input.audience,
        source_url: input.source_url,
        // The day it was written down — the meaning `verified_on` has on every
        // row. Nobody has checked the page yet, and the screen says so.
        verified_on: new Date().toISOString().slice(0, 10),
      })
      .select('id, status')
      .single()
    if (error) {
      if (error.code === '23505') {
        throw new Error('They already have a tip with that title. Call list_wellness_tips and pick another.')
      }
      throw new Error(error.message)
    }

    return `Saved as a draft (${data.id}), status ${data.status}. It is waiting in the Health tab under "Waiting for you" and is not part of their guidance until one of them keeps it.`
  },
})

const withdrawWellnessTip = defineTool({
  name: 'withdraw_wellness_tip',
  module: 'health',
  title: 'Withdraw a proposed tip',
  description:
    'Take back a draft that has not been kept yet, when the person says they do not want it. Only drafts: a tip one of them has kept can only be changed in the app, and the database refuses otherwise.',
  readOnly: false,
  inputSchema: z.object({
    tip_id: z.string().uuid().describe('A draft, from list_wellness_tips.'),
  }),
  async handler(ctx, input) {
    requireCouple(ctx)

    const { data, error } = await ctx.supabase
      .from('wellness_tips')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', input.tip_id)
      .eq('status', 'draft')
      .is('deleted_at', null)
      .select('id')
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return 'No waiting draft with that id — it may already have been kept, discarded or withdrawn.'

    return 'Withdrawn. Their guidance is unchanged.'
  },
})

export const wellnessTools: AnyTool[] = [listWellnessTips, proposeWellnessTip, withdrawWellnessTip]
