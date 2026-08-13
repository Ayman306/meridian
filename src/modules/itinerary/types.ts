import type { Tables } from '@/types/database'
import type { DateOnly } from '@/lib/dates'

export type Category = Tables<'categories'>
export type ItineraryItem = Tables<'itinerary_items'>
export type Suggestion = Tables<'suggestion_tray'>

export type ItemSource = 'manual' | 'wishlist' | 'blend' | 'ai'
export type ItemState = 'idea' | 'accepted' | 'booked' | 'done' | 'skipped'

/** Everything on one trip's plan, split the way the UI reads it. */
export interface Plan {
  /** Unscheduled — the idea pool. A first-class state, not a waiting room. */
  pool: ItineraryItem[]
  /** Scheduled items keyed by `yyyy-MM-dd`, each already in display order. */
  byDate: Record<DateOnly, ItineraryItem[]>
  /** Items whose date falls outside the trip's range after a date change. */
  orphaned: ItineraryItem[]
}

export type WarningKind = 'overlap' | 'tight' | 'busy'

export interface ItemWarning {
  kind: WarningKind
  itemId: string
  message: string
}
