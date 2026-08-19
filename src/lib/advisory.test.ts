/**
 * The point of these is the distinction between "no date" and "old date".
 *
 * A rule that was never claimed to be checked and a rule that was checked two
 * years ago are different failures, and collapsing them would either invent a
 * staleness that was never claimed or hide one that was.
 */
import { describe, expect, it } from 'vitest'
import { describeFreshness, freshness } from './advisory'

const TODAY = '2026-08-19'

describe('how old a rule is', () => {
  it('says nothing at all about a rule with no date', () => {
    // Not stale — unclaimed. Rendering "6 months old" here would be inventing
    // a fact about data that never made the claim.
    expect(freshness(null, TODAY)).toBeNull()
    expect(freshness(undefined, TODAY)).toBeNull()
    expect(describeFreshness(null)).toBe('')
  })

  it('leaves a recently checked rule alone', () => {
    const age = freshness('2026-06-01', TODAY)
    expect(age).toMatchObject({ months: 2, stale: false, veryStale: false })
    // A date with nothing after it already reads as recent. "Still current"
    // would be a claim this app cannot make.
    expect(describeFreshness(age)).toBe('')
  })

  it('marks a rule stale at six months', () => {
    expect(freshness('2026-02-19', TODAY)?.stale).toBe(true)
    expect(freshness('2026-02-20', TODAY)?.stale).toBe(false)
  })

  it('escalates the wording past eighteen months', () => {
    const old = freshness('2024-01-01', TODAY)
    expect(old?.veryStale).toBe(true)
    expect(describeFreshness(old)).toContain('2 years')
    expect(describeFreshness(old)).toContain('open the source')
  })

  it('says months, not years, in between', () => {
    const middling = freshness('2025-11-01', TODAY)
    expect(middling).toMatchObject({ stale: true, veryStale: false })
    expect(describeFreshness(middling)).toBe('Not checked in 9 months — worth confirming at the source.')
  })

  it('clamps a date in the future rather than reading as negative', () => {
    // Somebody's clock being wrong is not a reason to render nonsense.
    expect(freshness('2027-01-01', TODAY)).toMatchObject({ months: 0, stale: false })
  })
})
