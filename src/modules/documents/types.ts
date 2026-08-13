import type { Tables } from '@/types/database'
import type { DateOnly } from '@/lib/dates'

export type DocumentType = Tables<'document_types'>
export type TravelDocument = Tables<'documents'>
export type TripDocumentRequirement = Tables<'trip_document_requirements'>

/** How urgent an expiry is. Drives colour and sort order. */
export type ExpiryLevel = 'none' | 'ok' | 'warning' | 'blocking' | 'expired'

export interface ExpiryStatus {
  level: ExpiryLevel
  /** Whole months from the reference date until expiry. Null when no expiry. */
  months: number | null
  /** Plain-language reason, shown next to the document. */
  message: string | null
}

export interface DocumentWithType extends TravelDocument {
  type: DocumentType | null
}

/** One row of the per-person readiness report. */
export interface RequirementRow {
  user_id: string
  type_id: string
  type_name: string
  is_manual: boolean
  document_id: string | null
  expires_on: DateOnly | null
  satisfied: boolean
}

export interface ReadinessReport {
  userId: string
  required: RequirementRow[]
  satisfiedCount: number
  total: number
  /** Names of the types that are missing or expire too soon. */
  missing: string[]
}
