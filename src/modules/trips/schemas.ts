import { z } from 'zod'
import { isValidDateOnly } from '@/lib/dates'

const dateOnly = z
  .string()
  .refine((v) => v === '' || isValidDateOnly(v), 'Use a real date')
  .transform((v) => (v === '' ? null : v))
  .nullable()

export const datePrecisionSchema = z.enum(['exact', 'month', 'season', 'year', 'unknown'])

/**
 * A trip needs only a title. Everything else is optional, deliberately —
 * the container has to be cheap to create or nobody creates one.
 */
export const createTripSchema = z
  .object({
    title: z.string().trim().min(1, 'Give it a name — you can change it later').max(120),
    start_date: dateOnly.optional(),
    end_date: dateOnly.optional(),
    date_precision: datePrecisionSchema.default('unknown'),
    is_open_ended: z.boolean().default(false),
    status_id: z.string().uuid().nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((v) => !v.start_date || !v.end_date || v.end_date >= v.start_date, {
    message: 'The end is before the start',
    path: ['end_date'],
  })
  .refine((v) => v.date_precision === 'unknown' || Boolean(v.start_date), {
    message: 'Pick a date, or set the precision back to unknown',
    path: ['start_date'],
  })

export type CreateTripInput = z.input<typeof createTripSchema>
export type CreateTripValues = z.output<typeof createTripSchema>

export const travelerDatesSchema = z
  .object({
    arrival_date: dateOnly.optional(),
    departure_date: dateOnly.optional(),
    origin_airport: z
      .string()
      .trim()
      .toUpperCase()
      .max(4)
      .optional()
      .or(z.literal(''))
      .transform((v) => (v ? v : null)),
  })
  .refine((v) => !v.arrival_date || !v.departure_date || v.departure_date >= v.arrival_date, {
    message: 'You leave before you arrive',
    path: ['departure_date'],
  })

export type TravelerDatesInput = z.input<typeof travelerDatesSchema>
