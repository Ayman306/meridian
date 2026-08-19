/**
 * How long somebody may stay somewhere. Read-only, and advisory.
 *
 * Read-only is not laziness. These rules are copied from official sources with
 * a `verified_on` date attached, and they change without notice — a Schengen
 * rule rewritten by an assistant from memory is exactly the kind of confident,
 * plausible, wrong answer that gets somebody stopped at a border. Adding and
 * editing rules happens in the app, where the source URL is a required field.
 *
 * Every response carries the disclaimer and the verified date, because
 * non-negotiable #4 says advisory surfaces always do. A model repeating a day
 * count without saying where it came from and how old it is has stripped the
 * only two things that make it safe to act on.
 */
import { z } from 'zod'
import { ALLOWANCE_DISCLAIMER } from '@/modules/allowance/logic'
import { describeFreshness, freshness } from '@/lib/advisory'
import { defineTool, requireCouple } from './types'
import type { AnyTool } from './types'

const listAllowanceRules = defineTool({
  name: 'list_allowance_rules',
  module: 'allowance',
  title: 'List stay-allowance rules',
  description:
    'The stay-allowance rules recorded for this couple — how many days a passport may spend in a country, and over what window. ADVISORY ONLY: always quote the source and the verified date alongside any number from this, and say it is not immigration advice.',
  readOnly: true,
  inputSchema: z.object({
    country: z
      .string()
      .length(2)
      .nullable()
      .default(null)
      .describe('ISO 3166-1 alpha-2 destination to filter by. Omit for all of them.'),
  }),
  async handler(ctx, input) {
    requireCouple(ctx)

    let query = ctx.supabase
      .from('allowance_rules')
      .select(
        'id, label, passport_country, destination_country, rule_type, max_days, window_days, source_url, verified_on, notes',
      )
      .order('destination_country', { ascending: true })

    if (input.country) query = query.eq('destination_country', input.country.toUpperCase())

    const { data, error } = await query
    if (error) throw new Error(error.message)

    const rows = data ?? []
    if (rows.length === 0) {
      return input.country
        ? `No rule recorded for ${input.country.toUpperCase()}. That means nothing is known here, not that there is no limit.`
        : 'No allowance rules recorded yet.'
    }

    const today = new Date().toISOString().slice(0, 10)
    const lines = rows.map((row) => {
      const parts = [
        `${row.passport_country} → ${row.destination_country}`,
        row.label ?? row.rule_type,
        row.max_days ? `${row.max_days} days` : 'no day cap recorded',
      ]
      if (row.window_days) parts.push(`in any ${row.window_days}`)
      // The two things that make a number safe to act on. Never omitted.
      // How old the check is comes with it: a model told only "verified
      // 2024-01-01" will report the rule as fact, and a rule that has not been
      // looked at in two years is a starting point rather than an answer.
      if (row.verified_on) {
        const age = freshness(row.verified_on, today)
        const note = describeFreshness(age)
        parts.push(`verified ${row.verified_on}${note ? ` — ${note}` : ''}`)
      } else {
        parts.push('never verified')
      }
      if (row.source_url) parts.push(row.source_url)
      if (row.notes) parts.push(`— ${row.notes}`)
      return `- ${parts.join(' · ')}`
    })

    return [...lines, '', ALLOWANCE_DISCLAIMER].join('\n')
  },
})

const listEntries = defineTool({
  name: 'list_entries',
  module: 'allowance',
  title: 'List recorded entries and exits',
  description:
    'The border crossings recorded for this couple, which is what any day count is calculated from. If this log is incomplete then so is every allowance figure derived from it — say so rather than presenting a total as authoritative.',
  readOnly: true,
  inputSchema: z.object({
    country: z
      .string()
      .length(2)
      .nullable()
      .default(null)
      .describe('ISO 3166-1 alpha-2 country to filter by.'),
    limit: z.number().int().min(1).max(200).default(50).describe('How many to return, newest first.'),
  }),
  async handler(ctx, input) {
    requireCouple(ctx)

    let query = ctx.supabase
      .from('entry_exit_log')
      .select('id, country_code, entered_on, exited_on, is_estimated, notes')
      .order('entered_on', { ascending: false })
      .limit(input.limit)

    if (input.country) query = query.eq('country_code', input.country.toUpperCase())

    const { data, error } = await query
    if (error) throw new Error(error.message)

    const rows = data ?? []
    if (rows.length === 0) return 'No entries or exits recorded.'

    const lines = rows.map((row) => {
      const parts = [
        row.country_code,
        `${row.entered_on} → ${row.exited_on ?? 'still there'}`,
      ]
      // Estimated dates are the main reason a total can be wrong, so they are
      // labelled rather than presented alongside confirmed ones as equals.
      if (row.is_estimated) parts.push('estimated')
      if (row.notes) parts.push(`— ${row.notes}`)
      return `- ${parts.join(' · ')}`
    })

    return [...lines, '', ALLOWANCE_DISCLAIMER].join('\n')
  },
})

export const allowanceTools: AnyTool[] = [listAllowanceRules, listEntries]
