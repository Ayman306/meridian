import type { Tables } from '@/types/database'
import type { DateOnly } from '@/lib/dates'

export type Trip = Tables<'trips'>
export type TripStatus = Tables<'trip_statuses'>
export type TripTraveler = Tables<'trip_travelers'>
export type TripDay = Tables<'trip_days'>

export type DatePrecision = 'exact' | 'month' | 'season' | 'year' | 'unknown'
export type DayType = 'travel' | 'planned' | 'open' | 'rest' | 'work'
export type TripGroup = 'active' | 'upcoming' | 'planning' | 'past'

export interface TogetherWindow {
  start: DateOnly | null
  end: DateOnly | null
  nights: number
  /** False when the two windows don't intersect — almost always a typo. */
  overlaps: boolean
  /** True when we can't compute it yet: a missing traveler or missing dates. */
  incomplete: boolean
}

export interface TripSummary extends Trip {
  status: TripStatus | null
  travelers: TripTraveler[]
}

export interface TripDetail extends TripSummary {
  days: TripDay[]
}
