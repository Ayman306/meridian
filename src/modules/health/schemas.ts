import { z } from 'zod'
import { TIP_AUDIENCES, TIP_BODY_MAX, TIP_CATEGORIES, TIP_TITLE_MAX, isTipSourceUrl } from './logic'
import type { TipAudience, TipCategory } from './types'

/**
 * A tip a partner types in. The limits are the table's (0040), read from
 * `logic.ts` so the form, the assistant's tool and the database agree.
 *
 * The source link is required, not optional: a couple's own tip is advisory
 * data like the seeded ones, and advisory data always points at the authority
 * (non-negotiable #4).
 */
export const wellnessTipSchema = z.object({
  title: z.string().trim().min(1, 'Give it a title').max(TIP_TITLE_MAX),
  body: z.string().trim().min(1, 'Say what it is').max(TIP_BODY_MAX),
  category: z.enum(TIP_CATEGORIES as [TipCategory, ...TipCategory[]]),
  audience: z.enum(TIP_AUDIENCES as [TipAudience, ...TipAudience[]]),
  source_url: z
    .string()
    .trim()
    .refine(isTipSourceUrl, 'A link starting https:// — where this comes from'),
})

export type WellnessTipFormValues = z.output<typeof wellnessTipSchema>
