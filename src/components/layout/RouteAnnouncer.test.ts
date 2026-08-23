/**
 * What a screen reader is told when the page changes.
 *
 * The interesting cases are the ones that would be read aloud badly: a UUID in
 * the path is thirty-six characters of noise, and a bare slash has no name at
 * all. Both happen constantly in this app, since every trip screen is
 * `/trips/<uuid>/<tab>`.
 */
import { describe, expect, it } from 'vitest'
import { describeRoute } from './RouteAnnouncer'

describe('describeRoute', () => {
  it('names the root', () => {
    expect(describeRoute('/')).toBe('Home')
  })

  it('names a plain section', () => {
    expect(describeRoute('/trips')).toBe('Trips')
    expect(describeRoute('/gallery/albums')).toBe('Gallery, albums')
  })

  it('drops the trip id rather than reading it aloud', () => {
    // Hearing "trips, three-f-a-nine-b-two..." is worse than hearing nothing.
    expect(describeRoute('/trips/3fa9b2c1-4d5e-6f70-8901-234567890abc/plan')).toBe('Trips, plan')
  })

  it('reads a hyphenated segment as words', () => {
    expect(describeRoute('/some-section')).toBe('Some section')
  })

  it('always says something, even when every segment was dropped', () => {
    // A path made only of ids would otherwise announce an empty string, which
    // a live region treats as "nothing changed".
    expect(describeRoute('/3fa9b2c1-4d5e-6f70-8901-234567890abc')).toBe('Page')
  })
})
