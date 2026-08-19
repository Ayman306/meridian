import { z } from 'zod'
import { isValidDateOnly } from '@/lib/dates'

const emptyToNull = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === '' || v === undefined ? null : v), schema.nullable())

/** Uppercase ISO 4217, matching the database's own check. */
export const currencyCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Three-letter currency code, like EUR')

/**
 * Money, from a text input.
 *
 * Accepts what people actually type — "12,50", "€12.50", " 12.50 " — and
 * refuses what cannot be money. Two decimals, because the column is
 * numeric(12,2) and silently truncating a third is how a total stops matching
 * its parts.
 */
export const moneyAmount = z
  // union + transform + pipe rather than `preprocess`, so the *input* type
  // stays `string | number` instead of collapsing to `unknown`. React Hook
  // Form hands a text field's value through as a string, and the form is typed
  // on its output, so an `unknown` input makes the resolver unassignable.
  .union([z.string(), z.number()])
  .transform((v) => {
    if (typeof v === 'number') return v
    const cleaned = v.replace(/[^\d.,-]/g, '').replace(',', '.')
    return cleaned === '' ? Number.NaN : Number(cleaned)
  })
  .pipe(
    z
      .number({ invalid_type_error: 'Enter an amount' })
      .positive('An amount has to be more than zero')
      .max(9_999_999_999, 'That is more than this app can hold')
      // NaN is what an unparseable string becomes above. `.positive()` already
      // rejects it, but the message would be about being under zero.
      .refine((n: number) => !Number.isNaN(n), 'Enter an amount')
      .refine((n: number) => Number.isInteger(Math.round(n * 100)), 'At most two decimal places'),
  )

export const splitType = z.enum(['equal', 'exact', 'percent', 'full'])

export const expenseSchema = z.object({
  description: z.string().trim().min(1, 'What was it for?').max(200),
  amount: moneyAmount,
  currency: currencyCode,
  spent_on: z.string().refine(isValidDateOnly, 'Use a real date'),
  paid_by: z.string().uuid('Who paid?'),
  split_type: splitType.default('equal'),
  // Keyed by user id. Validated against the amount by `validateSplit`, which
  // can name the shortfall; zod only checks the shape here.
  split_detail: z.record(z.string().uuid(), z.number().nonnegative()).nullable().default(null),
  category_id: emptyToNull(z.string().uuid()),
  trip_id: emptyToNull(z.string().uuid()),
  itinerary_item_id: emptyToNull(z.string().uuid()),
  receipt_media_id: emptyToNull(z.string().uuid()),
  accommodation_id: emptyToNull(z.string().uuid()),
  notes: emptyToNull(z.string().trim().max(2000)),
})

export type ExpenseFormValues = z.output<typeof expenseSchema>
export type ExpenseFormInput = z.input<typeof expenseSchema>

export const settlementSchema = z.object({
  amount: moneyAmount,
  currency: currencyCode,
  settled_on: z.string().refine(isValidDateOnly, 'Use a real date'),
  from_user: z.string().uuid(),
  to_user: z.string().uuid(),
  trip_id: emptyToNull(z.string().uuid()),
  method: emptyToNull(z.string().trim().max(60)),
  notes: emptyToNull(z.string().trim().max(2000)),
})

export type SettlementFormValues = z.output<typeof settlementSchema>
export type SettlementFormInput = z.input<typeof settlementSchema>

export const budgetSchema = z.object({
  amount: moneyAmount,
  currency: currencyCode,
  category_id: emptyToNull(z.string().uuid()),
  period: z.enum(['trip', 'week']).default('trip'),
})

export type BudgetFormValues = z.output<typeof budgetSchema>

/** The body `/api/fx` accepts. */
export const fxRequestSchema = z.object({
  base: currencyCode,
  quote: currencyCode,
  on: z.string().refine(isValidDateOnly, 'Use a real date'),
})
