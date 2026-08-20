import type { DateOnly } from '@/lib/dates'

/**
 * What kind of thing a result is. Drives the icon, the label and — the part
 * that matters — where tapping it goes.
 */
export type ResultKind =
  | 'trip'
  | 'plan'
  | 'saved'
  | 'stay'
  | 'document'
  | 'expense'
  | 'photo'
  | 'destination'

export interface SearchResult {
  kind: ResultKind
  id: string
  title: string
  /** Whatever makes it identifiable without opening it: a city, an address. */
  subtitle: string | null
  tripId: string | null
  occurred: DateOnly | null
  rank: number
}
