import type { Tables } from '@/types/database'
import type { DateOnly } from '@/lib/dates'

export type HealthConsent = Tables<'health_consents'>
export type CycleLog = Tables<'cycle_logs'>
export type HealthRecord = Tables<'health_records'>
export type MedicationRestriction = Tables<'medication_restrictions'>

/** The scopes consent is granted at. Mirrors the check constraint in 0014. */
export type ConsentScope =
  | 'cycle'
  | 'cycle_predictions'
  | 'symptoms'
  | 'medications'
  | 'vaccinations'
  | 'notes'

export type RecordKind = 'medication' | 'vaccination' | 'condition' | 'allergy'
export type Flow = 'light' | 'medium' | 'heavy'

/**
 * A prediction, or an honest refusal to make one.
 *
 * `available: false` is a first-class result, not an error. Spec 12.7: fewer
 * than three cycles means no prediction and an explanation, never a guess.
 */
export type Prediction =
  | { available: false; reason: string; basedOn: number }
  | {
      available: true
      nextStart: DateOnly
      /** Days either side. Never rendered without it. */
      variance: number
      /** The window, which is what an irregular cycle is shown as. */
      earliest: DateOnly
      latest: DateOnly
      confidence: 'regular' | 'variable' | 'irregular'
      averageLength: number
      basedOn: number
      /** Always true. There is no branch where this is false. */
      isEstimate: true
    }

/** Whether a medication lasts the trip. */
export interface SupplyCheck {
  daysOfSupply: number
  tripNights: number
  /** Positive means running short by this many days. */
  shortfall: number
  /** False when the record carries no numbers to work from. */
  computable: boolean
}

/**
 * An estimated fertile window. Always an estimate — there is no branch of
 * `predictFertility` that returns a measurement, because the app has no way to
 * measure ovulation.
 */
export interface FertilityWindow {
  ovulation: DateOnly
  fertileFrom: DateOnly
  fertileTo: DateOnly
  /** Inherited from the cycle prediction. A wide cycle means a wide window. */
  variance: number
  /** Whether the luteal length came from a recorded ovulation or the default. */
  basedOn: 'observed' | 'estimated'
  lutealDays: number
  /** Always true. */
  isEstimate: true
}

/** Whether the cycle section applies to this person. */
export type CycleVisibility = 'shown' | 'hidden'
