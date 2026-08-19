/**
 * Travel documents — metadata only, and only when deliberately granted.
 *
 * The useful question this answers is "is my passport still valid for that
 * trip", which needs an expiry date and nothing else. So that is all it
 * returns.
 *
 * What is never returned, and why each one matters:
 *
 *   - **`storage_path`.** The object key in a private bucket. Handing it out
 *     invites the next tool to fetch it.
 *   - **Signed URLs.** They exist for 300 seconds (non-negotiable #3) precisely
 *     so a link cannot outlive the moment it was needed. Minting one into a
 *     model's context defeats the whole mechanism.
 *   - **`number_last4`.** Four digits of a passport number is not a passport
 *     number, but it is the sort of thing that ends up quoted back in a chat
 *     log, and no question worth asking here needs it.
 *
 * There is no write tool either. A document is a scan plus its details, and the
 * scan cannot come from a conversation — an entry with no file is a reminder
 * pretending to be a document.
 */
import { z } from 'zod'
import { defineTool, requireCouple } from './types'
import type { AnyTool } from './types'

const listDocuments = defineTool({
  name: 'list_documents',
  module: 'documents',
  title: 'List travel documents',
  description:
    'Passports, visas and insurance recorded for this couple, with their expiry dates. Metadata only — no files, no links and no document numbers are available through this. Use it to answer whether something is still valid for a trip.',
  readOnly: true,
  inputSchema: z.object({
    expiring_within_days: z
      .number()
      .int()
      .min(1)
      .max(3650)
      .nullable()
      .default(null)
      .describe('Only those expiring within this many days. Omit for everything.'),
  }),
  async handler(ctx, input) {
    requireCouple(ctx)

    // The column list is the security boundary here, not a convenience.
    // `storage_path` and `number_last4` exist on the row and are not selected.
    let query = ctx.supabase
      .from('documents')
      .select('id, label, country_code, issued_on, expires_on, is_shared, owner_id, notes')
      .is('deleted_at', null)
      .order('expires_on', { ascending: true, nullsFirst: false })

    if (input.expiring_within_days !== null) {
      const cutoff = new Date(Date.now() + input.expiring_within_days * 86_400_000)
      query = query.lte('expires_on', cutoff.toISOString().slice(0, 10))
    }

    const { data, error } = await query
    if (error) throw new Error(error.message)

    const rows = data ?? []
    if (rows.length === 0) {
      return input.expiring_within_days
        ? `Nothing expiring in the next ${input.expiring_within_days} days.`
        : 'No documents recorded.'
    }

    const today = new Date().toISOString().slice(0, 10)

    return rows
      .map((row) => {
        const parts = [row.label]
        if (row.country_code) parts.push(row.country_code)
        if (row.expires_on) {
          const expired = row.expires_on < today
          parts.push(`${expired ? 'EXPIRED' : 'expires'} ${row.expires_on}`)
        } else {
          parts.push('no expiry recorded')
        }
        parts.push(row.owner_id === ctx.userId ? 'yours' : 'theirs')
        if (row.notes) parts.push(`— ${row.notes}`)
        return `- ${parts.join(' · ')}`
      })
      .join('\n')
  },
})

export const documentTools: AnyTool[] = [listDocuments]
