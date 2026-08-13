import { z } from 'zod'
import { ACCENT_COLORS, INVITE_CODE_LENGTH } from '@/lib/constants'
import { isValidTimezone } from '@/lib/dates'

export const inviteCodeSchema = z
  .string()
  .trim()
  .length(INVITE_CODE_LENGTH, `Codes are ${INVITE_CODE_LENGTH} characters`)
  .regex(/^[A-HJ-NP-Z2-9]+$/i, 'That contains a character we never use in codes')

export const profileSetupSchema = z.object({
  display_name: z.string().trim().min(1, 'We need something to call you').max(60),
  home_city: z.string().trim().min(1, 'Where are you based?').max(120),
  home_country: z.string().trim().max(120).optional().nullable(),
  home_lat: z.number().min(-90).max(90).nullable().optional(),
  home_lng: z.number().min(-180).max(180).nullable().optional(),
  timezone: z.string().refine(isValidTimezone, 'Not a timezone we recognise'),
  nationality: z
    .string()
    .trim()
    .toUpperCase()
    .length(2, 'Use the two-letter country code')
    .optional()
    .or(z.literal('')),
  second_nationality: z
    .string()
    .trim()
    .toUpperCase()
    .length(2, 'Use the two-letter country code')
    .optional()
    .or(z.literal('')),
  accent_color: z.enum(Object.keys(ACCENT_COLORS) as [string, ...string[]]),
})

export type ProfileSetupInput = z.infer<typeof profileSetupSchema>

export const coupleSchema = z.object({
  name: z.string().trim().max(80).optional().or(z.literal('')),
  anniversary_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
})
