import type { Tables } from '@/types/database'

export type WishlistItem = Tables<'wishlist_items'>
export type WishlistVerdict = Tables<'wishlist_verdicts'>

export type Verdict = 'yes' | 'no' | 'maybe'

export interface WishlistItemWithVerdicts extends WishlistItem {
  verdicts: WishlistVerdict[]
}

/** A place both partners saved independently, matched by proximity or name. */
export interface MatchedPair {
  items: WishlistItemWithVerdicts[]
  /** How they were matched — worth showing, since proximity can be wrong. */
  matchedBy: 'proximity' | 'name'
}

/** The five sections of the blend view (spec 7.2). */
export interface BlendGroups {
  both: MatchedPair[]
  mine: WishlistItemWithVerdicts[]
  theirs: WishlistItemWithVerdicts[]
  clashes: WishlistItemWithVerdicts[]
  undecided: WishlistItemWithVerdicts[]
}

export type Pace = 'relaxed' | 'normal' | 'packed'

export interface DraftOptions {
  pace: Pace
  /** Bias the selection. Applied after the core picks are chosen. */
  moreFood?: boolean
  skipMuseums?: boolean
}

export interface DraftDay {
  date: string
  items: WishlistItem[]
}

export interface Draft {
  days: DraftDay[]
  /** Days deliberately left open — on a long stay, most of them. */
  openDays: string[]
  /** Why the generator stopped where it did, shown above the tray. */
  note: string
}
