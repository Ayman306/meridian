import type { Tables } from '@/types/database'
import type { Band } from './climate'

export type TripDestination = Tables<'trip_destinations'>
export type VisaRule = Tables<'visa_rules'>
export type AirportRoute = Tables<'airport_routes'>

export type DestinationState = 'candidate' | 'chosen' | 'rejected'

/** Spec 4.3. Tier 5 excludes a destination outright. */
export type VisaTier = 0 | 1 | 2 | 3 | 4 | 5

export interface Fairness {
  kind: 'balanced' | 'slight' | 'skewed' | 'heavy'
  /** Hours of difference. */
  diff: number
  /** Whose journey is longer, or null when they are equal. */
  towards: string | null
}

export interface FlightEstimate {
  hours: number
  /** False when the number came from `airport_routes` rather than a great circle. */
  isEstimated: boolean
}

/** What one partner faces for one candidate. */
export interface PersonView {
  userId: string
  flight: FlightEstimate | null
  /** Null when no rule is on file — which reads "unknown", never "visa-free". */
  visa: VisaRule | null
  /** Set when their own passport makes the destination home ground. */
  isHome: boolean
  /** Which of their two nationalities the rule above belongs to. */
  passport: string | null
}

/** One column of the comparison board. */
export interface BoardColumn {
  destination: TripDestination
  people: PersonView[]
  fairness: Fairness | null
  band: Band | null
  wishlistCount: number
  /** Set when either passport is tier 5 — the candidate is out, and why. */
  excluded: string | null
  /** Only present once a weight has been moved off zero. */
  score: ScoreBreakdown | null
}

export interface ScoreWeights {
  hours: number
  fairness: number
  visa: number
  season: number
  cost: number
  wishlist: number
}

export interface ScoreBreakdown {
  total: number
  parts: { key: keyof ScoreWeights; weight: number; value: number; contribution: number }[]
}
