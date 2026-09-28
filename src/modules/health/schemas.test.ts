import { describe, expect, it } from 'vitest'
import { wellnessTipSchema } from './schemas'

const valid = {
  title: 'Book the quiet room',
  body: 'Ask for a room away from the lift.',
  category: 'trip_prep',
  audience: 'everyone',
  source_url: 'https://example.org/quiet',
}

describe('wellnessTipSchema', () => {
  it('accepts a complete tip and trims it', () => {
    const parsed = wellnessTipSchema.parse({ ...valid, title: '  Book the quiet room  ' })
    expect(parsed.title).toBe('Book the quiet room')
  })

  it('requires a source link — a tip of your own is still advisory', () => {
    expect(wellnessTipSchema.safeParse({ ...valid, source_url: '' }).success).toBe(false)
    expect(wellnessTipSchema.safeParse({ ...valid, source_url: 'my GP said so' }).success).toBe(false)
  })

  it('holds the same limits as the table', () => {
    expect(wellnessTipSchema.safeParse({ ...valid, title: 'x'.repeat(121) }).success).toBe(false)
    expect(wellnessTipSchema.safeParse({ ...valid, body: 'x'.repeat(1201) }).success).toBe(false)
    expect(wellnessTipSchema.safeParse({ ...valid, title: '   ' }).success).toBe(false)
  })

  it('only offers the sections and audiences the table allows', () => {
    expect(wellnessTipSchema.safeParse({ ...valid, category: 'performance' }).success).toBe(false)
    expect(wellnessTipSchema.safeParse({ ...valid, audience: 'couples' }).success).toBe(false)
  })
})
