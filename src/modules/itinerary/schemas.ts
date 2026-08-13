import { z } from 'zod'
import { isValidDateOnly } from '@/lib/dates'

const emptyToNull = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === '' || v === undefined ? null : v), schema.nullable())

/**
 * An item needs a title. Everything else — including the date — is optional,
 * because an unscheduled idea is a first-class thing, not a draft.
 */
export const itemSchema = z
  .object({
    title: z.string().trim().min(1, 'What is it?').max(200),
    scheduled_date: emptyToNull(z.string().refine(isValidDateOnly, 'Use a real date')),
    start_time: emptyToNull(z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Use HH:MM')),
    end_time: emptyToNull(z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Use HH:MM')),
    duration_minutes: emptyToNull(z.coerce.number().int().positive().max(10080)),
    place_name: emptyToNull(z.string().trim().max(200)),
    lat: emptyToNull(z.coerce.number().min(-90).max(90)),
    lng: emptyToNull(z.coerce.number().min(-180).max(180)),
    address: emptyToNull(z.string().trim().max(400)),
    maps_url: emptyToNull(z.string().url('That is not a link')),
    category_id: emptyToNull(z.string().uuid()),
    notes: emptyToNull(z.string().trim().max(4000)),
    url: emptyToNull(z.string().url('That is not a link')),
    cost_estimate: emptyToNull(z.coerce.number().nonnegative()),
    currency: emptyToNull(z.string().trim().length(3)),
    proposed_by: emptyToNull(z.string().uuid()),
  })
  .refine((v) => !v.start_time || Boolean(v.scheduled_date), {
    message: 'A time needs a day to sit on',
    path: ['start_time'],
  })

export type ItemFormValues = z.output<typeof itemSchema>
export type ItemFormInput = z.input<typeof itemSchema>
