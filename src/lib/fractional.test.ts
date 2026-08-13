import { describe, expect, it } from 'vitest'
import { bySortKey, keyAtEnd, keyAtStart, keyBetween, keyForIndex, keysBetween } from '@/lib/fractional'

describe('fractional keys', () => {
  it('generates a key strictly between two others', () => {
    const a = keyBetween(null, null)
    const c = keyBetween(a, null)
    const b = keyBetween(a, c)
    expect(a < b).toBe(true)
    expect(b < c).toBe(true)
  })

  it('appends and prepends around an existing list', () => {
    const items = [{ sort_key: 'a1' }, { sort_key: 'a2' }]
    expect(keyAtEnd(items) > 'a2').toBe(true)
    expect(keyAtStart(items) < 'a1').toBe(true)
  })

  it('handles an empty list', () => {
    expect(keyAtEnd([])).toBe(keyBetween(null, null))
    expect(keyAtStart([])).toBe(keyBetween(null, null))
  })

  it('spreads n keys evenly', () => {
    const keys = keysBetween(null, null, 4)
    expect(keys).toHaveLength(4)
    expect([...keys].sort()).toEqual(keys)
  })

  it('places an item at an index without touching its siblings', () => {
    const ordered = [
      { id: '1', sort_key: 'a0' },
      { id: '2', sort_key: 'a1' },
      { id: '3', sort_key: 'a2' },
    ]
    const middle = keyForIndex(ordered, 1)
    expect(middle > 'a0').toBe(true)
    expect(middle < 'a1').toBe(true)

    const start = keyForIndex(ordered, 0)
    expect(start < 'a0').toBe(true)

    const end = keyForIndex(ordered, 3)
    expect(end > 'a2').toBe(true)
  })

  it('excludes the moving item when reordering within a list', () => {
    const ordered = [
      { id: '1', sort_key: 'a0' },
      { id: '2', sort_key: 'a1' },
      { id: '3', sort_key: 'a2' },
    ]
    // Move item 1 to the end: it should land after a2, not between a1 and a2.
    const key = keyForIndex(ordered, 2, '1')
    expect(key > 'a2').toBe(true)
  })

  it('clamps out-of-range indices', () => {
    const ordered = [{ id: '1', sort_key: 'a0' }]
    expect(keyForIndex(ordered, -5) < 'a0').toBe(true)
    expect(keyForIndex(ordered, 99) > 'a0').toBe(true)
  })

  it('sorts by key lexicographically', () => {
    const items = [{ sort_key: 'a2' }, { sort_key: 'a0' }, { sort_key: 'a1' }]
    expect([...items].sort(bySortKey).map((i) => i.sort_key)).toEqual(['a0', 'a1', 'a2'])
  })

  it('supports 50 reorders without unbounded key growth', () => {
    // Repeatedly dropping an item just after the first one is the pathological
    // case for fractional indexing; keys must stay short enough to be sane.
    let low = keyBetween(null, null)
    const high = keyBetween(low, null)
    for (let i = 0; i < 50; i++) low = keyBetween(low, high)
    expect(low.length).toBeLessThan(60)
    expect(low < high).toBe(true)
  })
})
