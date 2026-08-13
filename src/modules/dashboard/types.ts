import type { DateOnly } from '@/lib/dates'

export type CountdownState =
  | 'EMPTY' // no trips at all
  | 'PLANNING' // a trip exists but has no dates
  | 'COUNTDOWN' // dates set, still in the future
  | 'TRAVEL_DAY' // someone flies today
  | 'TOGETHER' // both arrived, before either leaves
  | 'DEPARTING' // someone goes home today

export interface Countdown {
  state: CountdownState
  tripId: string | null
  title: string | null
  /** Days until the trip starts. Only ever set for exact dates. */
  days: number | null
  /** For TOGETHER: which night of how many. */
  dayOfTotal: { day: number; total: number } | null
  /** What to show when a countdown would be wrong, e.g. "Spring 2026". */
  dateLabel: string | null
}

export type AlertKind =
  | 'document_expiring'
  | 'passport_validity'
  | 'stay_allowance'
  | 'flight_delay'
  | 'stale_trip'

export interface Alert {
  kind: AlertKind
  /** Lower sorts first. Fixed by the spec's priority list. */
  priority: number
  severity: 'warning' | 'blocking'
  title: string
  detail: string | null
  href: string | null
  ownerId: string | null
}

export interface DashboardTraveller {
  user_id: string
  arrival_date: DateOnly | null
  departure_date: DateOnly | null
  origin_airport?: string | null
}

export interface DashboardTrip {
  id: string
  title: string
  start_date: DateOnly | null
  end_date: DateOnly | null
  date_precision: string
  is_open_ended: boolean
  timezone: string | null
  status_name: string | null
}

export interface TogetherWindowRow {
  trip_id: string
  start_date: DateOnly | null
  end_date: DateOnly | null
  travellers: DashboardTraveller[]
}

export interface ExpiringDocumentRow {
  id: string
  label: string
  owner_id: string
  type_name: string | null
  expires_on: DateOnly
  is_passport: boolean
}

export interface StaleTripRow {
  id: string
  title: string
  updated_at: string
}

/** Exactly what `dashboard()` returns. */
export interface DashboardPayload {
  paired: boolean
  couple_id?: string
  next_trip?: DashboardTrip | null
  planning_trip?: { id: string; title: string; updated_at: string } | null
  travellers?: DashboardTraveller[]
  together_windows?: TogetherWindowRow[]
  expiring_documents?: ExpiringDocumentRow[]
  stale_trips?: StaleTripRow[]
  trip_count?: number
}

export interface NightsTogether {
  thisYear: number
  lifetime: number
}
