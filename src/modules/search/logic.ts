/**
 * Where a result goes, and what it is called.
 *
 * Pure, because the routing is the part worth testing: a result that links to
 * the wrong screen is worse than one that does not appear, and it is exactly
 * the kind of mistake that survives review — every case looks plausible in
 * isolation.
 */
import type { ResultKind, SearchResult } from './types'

export const KIND_LABELS: Record<ResultKind, string> = {
  trip: 'Trip',
  plan: 'On a plan',
  saved: 'Saved place',
  stay: 'Stay',
  document: 'Document',
  expense: 'Expense',
  photo: 'Photo',
  destination: 'Destination',
}

/**
 * The link for a result.
 *
 * Several kinds have no screen of their own — a saved place lives in a list, an
 * expense lives in a filtered ledger — so those link to the list that contains
 * them rather than inventing a detail route that does not exist. A trip-scoped
 * result goes to the trip when we know which one; without a trip id it falls
 * back to the global list, which is right for a save that was never attached to
 * a trip at all.
 */
export function hrefFor(result: SearchResult): string {
  switch (result.kind) {
    case 'trip':
      return `/trips/${result.id}`
    case 'plan':
      return result.tripId ? `/trips/${result.tripId}/plan` : '/trips'
    case 'saved':
      return '/wishlist'
    case 'stay':
      return result.tripId ? `/trips/${result.tripId}/where` : '/trips'
    case 'document':
      return `/documents/${result.id}`
    case 'expense':
      return result.tripId ? `/trips/${result.tripId}/money` : '/money'
    case 'photo':
      return result.tripId ? `/trips/${result.tripId}/photos` : '/gallery'
    case 'destination':
      return result.tripId ? `/trips/${result.tripId}/where` : '/trips'
  }
}

/**
 * Group results by kind, in a fixed order.
 *
 * Fixed rather than by rank, because a list whose *sections* reorder as you
 * type is a list you cannot aim at: the thing you were reaching for moves
 * under your finger. Within a section the database's ranking is kept.
 */
const ORDER: ResultKind[] = [
  'trip',
  'plan',
  'saved',
  'stay',
  'destination',
  'document',
  'expense',
  'photo',
]

export function groupResults(results: readonly SearchResult[]): {
  kind: ResultKind
  results: SearchResult[]
}[] {
  return ORDER.map((kind) => ({ kind, results: results.filter((r) => r.kind === kind) })).filter(
    (group) => group.results.length > 0,
  )
}

/** Below this a query matches half the library, so nothing is sent. */
export const MIN_QUERY_LENGTH = 2

export function isSearchable(query: string): boolean {
  return query.trim().length >= MIN_QUERY_LENGTH
}
