/**
 * Health, for the person whose token this is and nobody else.
 *
 * Only available when the token's owner ticked `health` deliberately — it is
 * never in the default scope. See the note in `registry.ts` for why that is the
 * shape rather than a flat refusal.
 *
 * ## Two fences, not one
 *
 * RLS already restricts `cycle_logs` and `health_records` to
 * `owner_id = auth.uid()`, with a second policy letting a partner read a scope
 * they have been granted consent for (0014). That consent path is right for the
 * app and wrong here: consent was given so a partner could look, in the app,
 * with their own eyes — not so an assistant holding somebody's token could
 * sweep up whatever they had been trusted with.
 *
 * So every query below also filters `owner_id = ctx.userId` explicitly. The
 * database would already refuse another couple; this makes sure a token cannot
 * reach even the one other person it might legitimately have consent for. A
 * test asserts the filter is present in every query in this file.
 *
 * ## What is deliberately not here
 *
 * No delete. `delete_all_health_data()` is irreversible by design — there is no
 * thirty-day bin for health data, because data that lingers after somebody
 * deleted it is not deleted. A tool that could call it would put an
 * irreversible, total erasure one hallucinated tool call away.
 */
import { z } from 'zod'
import { FERTILITY_DISCLAIMER, HEALTH_DISCLAIMER } from '@/modules/health/logic'
import { defineTool } from './types'
import type { AnyTool } from './types'

const listCycles = defineTool({
  name: 'list_cycles',
  module: 'health',
  title: 'List cycle logs',
  description:
    'Your own cycle history, newest first, with any recorded ovulation day. Yours only — this can never read anybody else’s, whatever sharing is set up in the app.',
  readOnly: true,
  inputSchema: z.object({
    limit: z.number().int().min(1).max(60).default(12).describe('How many to return, newest first.'),
  }),
  async handler(ctx, input) {
    const { data, error } = await ctx.supabase
      .from('cycle_logs')
      .select('id, started_on, ended_on, flow, ovulation_on, luteal_days, notes')
      .eq('owner_id', ctx.userId)
      .order('started_on', { ascending: false })
      .limit(input.limit)
    if (error) throw new Error(error.message)

    const rows = data ?? []
    if (rows.length === 0) return 'Nothing logged yet.'

    const lines = rows.map((row) => {
      const parts = [row.started_on]
      if (row.ended_on) parts.push(`ended ${row.ended_on}`)
      if (row.flow) parts.push(row.flow)
      if (row.ovulation_on) parts.push(`ovulation recorded ${row.ovulation_on}`)
      if (row.notes) parts.push(`— ${row.notes}`)
      return `- ${parts.join(' · ')}`
    })

    return [...lines, '', FERTILITY_DISCLAIMER].join('\n')
  },
})

const logCycle = defineTool({
  name: 'log_cycle',
  module: 'health',
  title: 'Log a cycle',
  description:
    'Record the start of a period, and optionally its end and flow. Writes to your own log only. Do not infer a start date — record the one you were told.',
  readOnly: false,
  inputSchema: z.object({
    started_on: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .describe('YYYY-MM-DD. The day it started, as reported — never estimated.'),
    ended_on: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .default(null)
      .describe('YYYY-MM-DD, if it has finished.'),
    flow: z
      .enum(['light', 'medium', 'heavy'])
      .nullable()
      .default(null)
      .describe('Only if it was actually described.'),
    notes: z.string().nullable().default(null).describe('Anything recorded verbatim.'),
  }),
  async handler(ctx, input) {
    const { data, error } = await ctx.supabase
      .from('cycle_logs')
      .insert({
        owner_id: ctx.userId,
        started_on: input.started_on,
        ended_on: input.ended_on,
        flow: input.flow,
        notes: input.notes,
      })
      .select('id')
      .single()
    if (error) throw new Error(error.message)

    return `Logged a cycle starting ${input.started_on} (${data.id}). ${HEALTH_DISCLAIMER}`
  },
})

const listHealthRecords = defineTool({
  name: 'list_health_records',
  module: 'health',
  title: 'List medications and vaccinations',
  description:
    'Your own medications, vaccinations and other health records, with any expiry dates. Useful for questions like whether a vaccination is still valid for a destination. Yours only.',
  readOnly: true,
  inputSchema: z.object({
    kind: z
      .enum(['medication', 'vaccination', 'condition', 'allergy'])
      .nullable()
      .default(null)
      .describe('Filter to one kind, or omit for all of them.'),
  }),
  async handler(ctx, input) {
    let query = ctx.supabase
      .from('health_records')
      .select('id, kind, label, detail, dosage, frequency, started_on, valid_until')
      .eq('owner_id', ctx.userId)
      .order('kind', { ascending: true })

    if (input.kind) query = query.eq('kind', input.kind)

    const { data, error } = await query
    if (error) throw new Error(error.message)

    const rows = data ?? []
    if (rows.length === 0) return input.kind ? `No ${input.kind} records.` : 'No health records.'

    const lines = rows.map((row) => {
      const parts = [`${row.kind}: ${row.label}`]
      if (row.dosage) parts.push(row.dosage)
      if (row.frequency) parts.push(row.frequency)
      if (row.valid_until) parts.push(`valid until ${row.valid_until}`)
      if (row.detail) parts.push(`— ${row.detail}`)
      return `- ${parts.join(' · ')}`
    })

    return [...lines, '', HEALTH_DISCLAIMER].join('\n')
  },
})

const addHealthRecord = defineTool({
  name: 'add_health_record',
  module: 'health',
  title: 'Add a health record',
  description:
    'Record a medication, vaccination, condition or allergy of your own. Never advise on dosage or substitution — record what you were told, exactly as told.',
  readOnly: false,
  inputSchema: z.object({
    kind: z.enum(['medication', 'vaccination', 'condition', 'allergy']).describe('What sort of record.'),
    label: z.string().min(1).describe('Its name, as given.'),
    dosage: z.string().nullable().default(null).describe('Verbatim, if stated. Never computed.'),
    frequency: z.string().nullable().default(null).describe('Verbatim, if stated.'),
    started_on: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .default(null)
      .describe('YYYY-MM-DD, if known.'),
    valid_until: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .default(null)
      .describe('YYYY-MM-DD. For a vaccination, when it stops counting.'),
    detail: z.string().nullable().default(null).describe('Anything else, verbatim.'),
  }),
  async handler(ctx, input) {
    const { data, error } = await ctx.supabase
      .from('health_records')
      .insert({
        owner_id: ctx.userId,
        kind: input.kind,
        label: input.label,
        dosage: input.dosage,
        frequency: input.frequency,
        started_on: input.started_on,
        valid_until: input.valid_until,
        detail: input.detail,
      })
      .select('id')
      .single()
    if (error) throw new Error(error.message)

    return `Recorded ${input.kind} "${input.label}" (${data.id}). ${HEALTH_DISCLAIMER}`
  },
})

export const healthTools: AnyTool[] = [listCycles, logCycle, listHealthRecords, addHealthRecord]
