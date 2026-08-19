import type { Tables } from '@/types/database'
import type { DateOnly } from '@/lib/dates'

export type Accommodation = Tables<'accommodations'>

export type StayKind = 'hotel' | 'apartment' | 'guesthouse' | 'family' | 'other'

/**
 * A run of nights nobody has booked.
 *
 * Nights rather than days, and a half-open range like the table's own: `from`
 * is the first unbooked night, `to` is the morning after the last one. A gap of
 * one night has `to = from + 1`.
 */
export interface StayGap {
  from: DateOnly
  to: DateOnly
  nights: number
}

/** Two bookings claiming the same night — almost always a mistake. */
export interface StayOverlap {
  a: Accommodation
  b: Accommodation
  from: DateOnly
  nights: number
}
