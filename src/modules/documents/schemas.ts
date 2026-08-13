import { z } from 'zod'
import { isValidDateOnly } from '@/lib/dates'

const emptyToNull = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === '' || v === undefined ? null : v), schema.nullable())

export const documentSchema = z
  .object({
    label: z.string().trim().min(1, 'Give it a name you will recognise').max(120),
    type_id: emptyToNull(z.string().uuid()),
    country_code: emptyToNull(z.string().trim().toUpperCase().length(2, 'Two-letter country code')),
    // Only ever the last four. The form asks for them directly rather than
    // accepting a full number and truncating, so the whole number never has to
    // exist in the page at all.
    number_last4: emptyToNull(z.string().trim().regex(/^\d{1,4}$/, 'Up to four digits')),
    issued_on: emptyToNull(z.string().refine(isValidDateOnly, 'Use a real date')),
    expires_on: emptyToNull(z.string().refine(isValidDateOnly, 'Use a real date')),
    is_shared: z.boolean().default(true),
    notes: emptyToNull(z.string().trim().max(2000)),
  })
  .refine((v) => !v.issued_on || !v.expires_on || v.expires_on >= v.issued_on, {
    message: 'It expires before it was issued',
    path: ['expires_on'],
  })

export type DocumentFormValues = z.output<typeof documentSchema>
export type DocumentFormInput = z.input<typeof documentSchema>
