/**
 * Where a result goes when you tap it.
 *
 * This is the part of search worth testing hardest. A result that links to the
 * wrong screen is worse than one that never appeared — the person believes they
 * have found the thing and then cannot see it — and every case looks plausible
 * in isolation, which is exactly the kind of mistake that survives review.
 */
import { describe, expect, it } from 'vitest'
import { groupResults, hrefFor, isSearchable, KIND_LABELS } from './logic'
import type { ResultKind, SearchResult } from './types'

const result = (over: Partial<SearchResult> = {}): SearchResult => ({
  kind: 'saved',
  id: 'r1',
  title: 'Borough Market',
  subtitle: 'London',
  tripId: null,
  occurred: null,
  rank: 1,
  ...over,
})

describe('where a result links to', () => {
  it('sends a trip to its own page', () => {
    expect(hrefFor(result({ kind: 'trip', id: 't1' }))).toBe('/trips/t1')
  })

  it('sends trip-scoped results to the right tab of the right trip', () => {
    expect(hrefFor(result({ kind: 'plan', tripId: 't1' }))).toBe('/trips/t1/plan')
    expect(hrefFor(result({ kind: 'stay', tripId: 't1' }))).toBe('/trips/t1/where')
    expect(hrefFor(result({ kind: 'expense', tripId: 't1' }))).toBe('/trips/t1/money')
    expect(hrefFor(result({ kind: 'photo', tripId: 't1' }))).toBe('/trips/t1/photos')
    expect(hrefFor(result({ kind: 'destination', tripId: 't1' }))).toBe('/trips/t1/where')
  })

  it('falls back to the global list when there is no trip', () => {
    // A save that was never attached to a trip, an expense outside one, a
    // photo from an ordinary Tuesday. Linking to `/trips/null/...` is the bug
    // this case exists to prevent.
    expect(hrefFor(result({ kind: 'expense', tripId: null }))).toBe('/money')
    expect(hrefFor(result({ kind: 'photo', tripId: null }))).toBe('/gallery')
    expect(hrefFor(result({ kind: 'plan', tripId: null }))).toBe('/trips')
  })

  it('sends a document to its own page, since it has one', () => {
    expect(hrefFor(result({ kind: 'document', id: 'd1' }))).toBe('/documents/d1')
  })

  it('sends a saved place to the list that holds it', () => {
    // The wishlist has no detail route, so inventing one would 404.
    expect(hrefFor(result({ kind: 'saved' }))).toBe('/wishlist')
  })

  it('has a label and a destination for every kind there is', () => {
    // Guards the guard: a new kind added to the database function without a
    // label here would render a blank heading.
    const kinds: ResultKind[] = [
      'trip', 'plan', 'saved', 'stay', 'document', 'expense', 'photo', 'destination',
    ]
    for (const kind of kinds) {
      expect(KIND_LABELS[kind]).toBeTruthy()
      expect(hrefFor(result({ kind, tripId: 't1' }))).toMatch(/^\//)
    }
  })
})

describe('grouping', () => {
  it('orders sections the same way every time, whatever the ranking', () => {
    // A list whose *sections* reorder as you type is a list you cannot aim at:
    // the thing you were reaching for moves under your finger.
    const groups = groupResults([
      result({ kind: 'photo', id: 'p', rank: 9 }),
      result({ kind: 'trip', id: 't', rank: 0.1 }),
      result({ kind: 'saved', id: 's', rank: 5 }),
    ])
    expect(groups.map((g) => g.kind)).toEqual(['trip', 'saved', 'photo'])
  })

  it('keeps the database ranking within a section', () => {
    const groups = groupResults([
      result({ kind: 'saved', id: 'second', rank: 2 }),
      result({ kind: 'saved', id: 'first', rank: 9 }),
    ])
    // Order is preserved as given — the database already sorted by rank.
    expect(groups[0]!.results.map((r) => r.id)).toEqual(['second', 'first'])
  })

  it('leaves out sections with nothing in them', () => {
    expect(groupResults([result({ kind: 'trip' })]).map((g) => g.kind)).toEqual(['trip'])
  })

  it('says nothing about an empty result set', () => {
    expect(groupResults([])).toEqual([])
  })
})

describe('when a query is worth sending', () => {
  it('refuses one character, which matches half the library', () => {
    expect(isSearchable('a')).toBe(false)
    expect(isSearchable(' ')).toBe(false)
    expect(isSearchable('')).toBe(false)
  })

  it('accepts two', () => {
    expect(isSearchable('bo')).toBe(true)
  })

  it('ignores surrounding whitespace when deciding', () => {
    expect(isSearchable('  a  ')).toBe(false)
    expect(isSearchable('  bo  ')).toBe(true)
  })
})
