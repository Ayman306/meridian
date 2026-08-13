/**
 * Fractional index keys for drag-and-drop ordering (spec 0.6).
 *
 * Reordering must be a single-row UPDATE — never a rewrite of every sibling.
 * We wrap the `fractional-indexing` package rather than hand-rolling it; the
 * edge cases around key-length growth are non-obvious.
 */
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing'

/**
 * A key strictly between `a` and `b`. Either may be null to mean
 * "start of list" / "end of list".
 */
export function keyBetween(a: string | null, b: string | null): string {
  return generateKeyBetween(a, b)
}

/** `n` evenly spread keys between `a` and `b`. Used for seeding and bulk moves. */
export function keysBetween(a: string | null, b: string | null, n: number): string[] {
  return generateNKeysBetween(a, b, n)
}

/** The key for a brand-new item appended after everything in `existing`. */
export function keyAtEnd(existing: readonly { sort_key: string }[]): string {
  const last = existing.length ? existing[existing.length - 1]!.sort_key : null
  return keyBetween(last, null)
}

/** The key for an item that should sort before everything in `existing`. */
export function keyAtStart(existing: readonly { sort_key: string }[]): string {
  const first = existing.length ? existing[0]!.sort_key : null
  return keyBetween(null, first)
}

/**
 * The key for dropping an item at `index` within an ordered list, ignoring the
 * item itself if it is already present (a within-list move).
 */
export function keyForIndex(
  ordered: readonly { id: string; sort_key: string }[],
  index: number,
  movingId?: string,
): string {
  const siblings = movingId ? ordered.filter((i) => i.id !== movingId) : ordered
  const clamped = Math.max(0, Math.min(index, siblings.length))
  const before = clamped > 0 ? (siblings[clamped - 1]?.sort_key ?? null) : null
  const after = clamped < siblings.length ? (siblings[clamped]?.sort_key ?? null) : null
  return keyBetween(before, after)
}

/** Ascending comparator over `sort_key`. Keys are ordered lexicographically. */
export function bySortKey<T extends { sort_key: string }>(a: T, b: T): number {
  return a.sort_key < b.sort_key ? -1 : a.sort_key > b.sort_key ? 1 : 0
}
