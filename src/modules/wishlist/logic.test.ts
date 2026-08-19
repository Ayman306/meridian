import { describe, expect, it } from 'vitest'
import {
  applyPacing,
  balanceAuthorship,
  blendCity,
  buildBlend,
  clusterByLocation,
  generateDraft,
  groupByCity,
  isSamePlace,
  normaliseTitle,
  orderByProximity,
  pickSpreadDays,
} from '@/modules/wishlist/logic'
import type { WishlistItemWithVerdicts } from '@/modules/wishlist/types'

const ME = 'me'
const THEM = 'them'

let seq = 0
const save = (over: Partial<WishlistItemWithVerdicts> = {}): WishlistItemWithVerdicts => ({
  id: `w${++seq}`,
  couple_id: 'c1',
  user_id: ME,
  title: 'Somewhere',
  city: 'Lisbon',
  country_code: 'PT',
  lat: null,
  lng: null,
  place_name: null,
  address: null,
  maps_url: null,
  category_id: null,
  intensity: null,
  url: null,
  notes: null,
  image_url: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  deleted_at: null,
  verdicts: [],
  ...over,
})

const vote = (userId: string, verdict: 'yes' | 'no' | 'maybe') => ({
  wishlist_id: 'w',
  user_id: userId,
  verdict,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
})

describe('normaliseTitle', () => {
  it('strips case, punctuation and a leading article', () => {
    expect(normaliseTitle('The Ivy')).toBe('ivy')
    expect(normaliseTitle('  ivy!  ')).toBe('ivy')
    expect(normaliseTitle('La Cevicheria')).toBe('cevicheria')
  })

  it('leaves a word that merely starts with an article alone', () => {
    // "Theatro" is not "the atro".
    expect(normaliseTitle('Theatro Circo')).toBe('atrocirco')
  })
})

describe('isSamePlace', () => {
  it('matches two saves within 150 metres', () => {
    const a = save({ lat: 38.7139, lng: -9.1394, title: 'Pastel place' })
    const b = save({ lat: 38.7142, lng: -9.1396, title: 'Pastéis de Belém' })
    expect(isSamePlace(a, b)).toBe('proximity')
  })

  it('does not match two saves a kilometre apart', () => {
    const a = save({ title: 'A bar', lat: 38.7139, lng: -9.1394 })
    const b = save({ title: 'A viewpoint', lat: 38.7239, lng: -9.1394 })
    expect(isSamePlace(a, b)).toBeNull()
  })

  it('matches by name only within the same city', () => {
    expect(isSamePlace(save({ title: 'The Ivy' }), save({ title: 'ivy' }))).toBe('name')
    expect(isSamePlace(save({ title: 'Central Park' }), save({ title: 'central park', city: 'New York' }))).toBeNull()
  })
})

describe('buildBlend', () => {
  it('puts the same restaurant saved from two different sources in "both"', () => {
    // The spec's acceptance test, verbatim: different URLs, no shared title.
    const mine = save({
      user_id: ME,
      title: 'that seafood place',
      url: 'https://instagram.com/p/abc',
      lat: 38.7139,
      lng: -9.1394,
    })
    const theirs = save({
      user_id: THEM,
      title: 'Cervejaria Ramiro',
      url: 'https://someblog.example/lisbon',
      lat: 38.714,
      lng: -9.1395,
    })

    const blend = buildBlend([mine, theirs], ME, THEM)
    expect(blend.both).toHaveLength(1)
    expect(blend.both[0]!.matchedBy).toBe('proximity')
    expect(blend.mine).toHaveLength(0)
    expect(blend.theirs).toHaveLength(0)
  })

  it('leaves "both" empty when only one of them has saved anything', () => {
    const blend = buildBlend([save({ user_id: ME }), save({ user_id: ME })], ME, THEM)
    expect(blend.both).toHaveLength(0)
    expect(blend.mine).toHaveLength(2)
  })

  it('treats a partner "no" as a clash, not a rejection of the save', () => {
    const item = save({ user_id: ME, verdicts: [vote(THEM, 'no')] })
    const blend = buildBlend([item], ME, THEM)
    expect(blend.clashes.map((i) => i.id)).toEqual([item.id])
    expect(blend.mine).toHaveLength(0)
  })

  it('counts their unvoted saves as undecided, and never your own', () => {
    const theirs = save({ user_id: THEM, title: 'A tile shop' })
    const mine = save({ user_id: ME, title: 'A bookshop' })
    const blend = buildBlend([theirs, mine], ME, THEM)
    expect(blend.undecided.map((i) => i.id)).toEqual([theirs.id])
  })

  it('sorts by intensity descending', () => {
    const low = save({ user_id: ME, intensity: 2, title: 'low' })
    const high = save({ user_id: ME, intensity: 5, title: 'high' })
    const blend = buildBlend([low, high], ME, THEM)
    expect(blend.mine.map((i) => i.title)).toEqual(['high', 'low'])
  })

  it('ignores deleted saves', () => {
    const blend = buildBlend([save({ deleted_at: '2026-02-01T00:00:00Z' })], ME, THEM)
    expect(blend.mine).toHaveLength(0)
  })
})

describe('blendCity', () => {
  const items = [save({ city: 'Lisbon' }), save({ city: 'Tokyo' })]

  it('uses the chosen destination, whatever the trip is called', () => {
    // The whole point of the change: a trip called "Summer" with Porto chosen
    // is a Porto trip, and the title has nothing to say about it.
    expect(blendCity('Porto', 'Summer', items)).toBe('Porto')
    expect(blendCity('Porto', 'Lisbon in May', items)).toBe('Porto')
  })

  it('falls back to the title for a trip with no board filled in', () => {
    expect(blendCity(null, 'Lisbon in May', items)).toBe('Lisbon')
  })

  it('narrows nothing when neither says anything', () => {
    // The safe direction to be wrong in: too much shown is a longer list, too
    // little hides somebody's own save from them.
    expect(blendCity(null, 'Summer', items)).toBeNull()
    expect(blendCity(null, null, items)).toBeNull()
    expect(blendCity('   ', 'Summer', items)).toBeNull()
  })
})

describe('groupByCity', () => {
  it('files the city-less ones under Unfiled', () => {
    const groups = groupByCity([save({ city: 'Porto' }), save({ city: null }), save({ city: '  ' })])
    expect(Object.keys(groups).sort()).toEqual(['Porto', 'Unfiled'])
    expect(groups.Unfiled).toHaveLength(2)
  })
})

describe('pickSpreadDays', () => {
  it('returns every day when it can', () => {
    expect(pickSpreadDays(['2026-06-01', '2026-06-02'], 5)).toEqual(['2026-06-01', '2026-06-02'])
  })

  it('avoids the arrival and departure days when there is room', () => {
    const days = ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05']
    const picked = pickSpreadDays(days, 2)
    expect(picked).not.toContain('2026-06-01')
    expect(picked).not.toContain('2026-06-05')
  })
})

describe('clusterByLocation', () => {
  it('separates two parts of town', () => {
    const west = [save({ lat: 38.69, lng: -9.22 }), save({ lat: 38.691, lng: -9.221 })]
    const east = [save({ lat: 38.73, lng: -9.11 }), save({ lat: 38.731, lng: -9.112 })]
    const clusters = clusterByLocation([...west, ...east], 2)

    const ids = clusters.map((c) => new Set(c.map((i) => i.id)))
    const together = (a: string, b: string) => ids.some((set) => set.has(a) && set.has(b))
    expect(together(west[0]!.id, west[1]!.id)).toBe(true)
    expect(together(east[0]!.id, east[1]!.id)).toBe(true)
    expect(together(west[0]!.id, east[0]!.id)).toBe(false)
  })

  it('is deterministic — the same input gives the same draft twice', () => {
    const items = [
      save({ lat: 38.69, lng: -9.22 }),
      save({ lat: 38.73, lng: -9.11 }),
      save({ lat: 38.7, lng: -9.2 }),
    ]
    const first = clusterByLocation(items, 2).map((c) => c.map((i) => i.id))
    const second = clusterByLocation(items, 2).map((c) => c.map((i) => i.id))
    expect(first).toEqual(second)
  })

  it('deals coordinate-less saves round-robin rather than dropping them', () => {
    const clusters = clusterByLocation([save(), save(), save()], 2)
    expect(clusters.flat()).toHaveLength(3)
  })
})

describe('orderByProximity', () => {
  it('walks the nearest neighbour rather than the input order', () => {
    const a = save({ title: 'a', lat: 0, lng: 0 })
    const far = save({ title: 'far', lat: 0, lng: 1 })
    const near = save({ title: 'near', lat: 0, lng: 0.1 })

    expect(orderByProximity([a, far, near]).map((i) => i.title)).toEqual(['a', 'near', 'far'])
  })

  it('keeps coordinate-less items, at the end', () => {
    const placed = save({ lat: 0, lng: 0 })
    const unplaced = save({ title: 'no idea where' })
    expect(orderByProximity([unplaced, placed]).map((i) => i.title)).toEqual([
      placed.title,
      'no idea where',
    ])
  })
})

describe('applyPacing', () => {
  it('stops at the day capacity', () => {
    const items = [save(), save(), save(), save()]
    expect(applyPacing(items, { items: 2, anchors: 1 })).toHaveLength(2)
  })

  it('refuses three of the same category in a row', () => {
    const food = () => save({ category_id: 'food' })
    const sight = save({ category_id: 'sight' })
    const paced = applyPacing([food(), food(), food(), sight], { items: 4, anchors: 1 })

    const categories = paced.map((i) => i.category_id)
    expect(categories.slice(0, 3)).toEqual(['food', 'food', 'sight'])
  })
})

describe('balanceAuthorship', () => {
  it('alternates whose pick opens each day', () => {
    const days = [
      { date: '2026-06-02', items: [save({ user_id: THEM }), save({ user_id: ME })] },
      { date: '2026-06-03', items: [save({ user_id: ME }), save({ user_id: THEM })] },
    ]
    const balanced = balanceAuthorship(days, ME)
    expect(balanced[0]!.items[0]!.user_id).toBe(ME)
    expect(balanced[1]!.items[0]!.user_id).toBe(THEM)
  })
})

describe('generateDraft', () => {
  const days = (n: number, from = 1) =>
    Array.from({ length: n }, (_, i) => `2026-06-${String(from + i).padStart(2, '0')}`)

  const someSaves = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      save({
        user_id: i % 2 === 0 ? ME : THEM,
        title: `place ${i}`,
        lat: 38.7 + i * 0.01,
        lng: -9.14 + i * 0.01,
      }),
    )

  it('runs with no AI configured — it is arithmetic', () => {
    const draft = generateDraft(someSaves(6), days(3), ME, THEM, { pace: 'normal' })
    expect(draft.days.length).toBeGreaterThan(0)
    expect(draft.days.flatMap((d) => d.items).length).toBeGreaterThan(0)
  })

  it('plans at most 10 days of a 25-night trip', () => {
    // Spec 7.7. 26 calendar days; 40% is 10.
    const draft = generateDraft(someSaves(40), days(26), ME, THEM, { pace: 'packed' })
    expect(draft.days.length).toBeLessThanOrEqual(10)
    expect(draft.openDays.length).toBeGreaterThanOrEqual(16)
    expect(draft.note).toContain('open days are the point')
  })

  it('plans only the days it can fill', () => {
    const draft = generateDraft(someSaves(2), days(5), ME, THEM, { pace: 'relaxed' })
    expect(draft.days.length).toBeLessThanOrEqual(2)
    expect(draft.openDays.length).toBeGreaterThan(0)
  })

  it('says so rather than failing when there is nothing saved', () => {
    const draft = generateDraft([], days(3), ME, THEM, { pace: 'normal' })
    expect(draft.days).toHaveLength(0)
    expect(draft.openDays).toHaveLength(3)
    expect(draft.note).toMatch(/add a few places/i)
  })

  it('says so rather than failing when the trip has no dates', () => {
    const draft = generateDraft(someSaves(4), [], ME, THEM, { pace: 'normal' })
    expect(draft.days).toHaveLength(0)
    expect(draft.note).toMatch(/trip dates/i)
  })

  it('respects pace: relaxed plans fewer items per day than packed', () => {
    const items = someSaves(24)
    const relaxed = generateDraft(items, days(4), ME, THEM, { pace: 'relaxed' })
    const packed = generateDraft(items, days(4), ME, THEM, { pace: 'packed' })

    const perDay = (d: typeof relaxed) => Math.max(...d.days.map((x) => x.items.length))
    expect(perDay(relaxed)).toBeLessThan(perDay(packed))
  })

  it('leaves museums out when asked to, in the local language too', () => {
    const items = [
      save({ user_id: ME, title: 'Museu do Azulejo', lat: 38.72, lng: -9.11, intensity: 5 }),
      save({ user_id: THEM, title: 'A bakery', lat: 38.75, lng: -9.15, intensity: 5 }),
    ]
    const draft = generateDraft(items, days(2), ME, THEM, { pace: 'normal', skipMuseums: true })
    const titles = draft.days.flatMap((d) => d.items.map((i) => i.title))
    expect(titles).not.toContain('Museu do Azulejo')
    expect(titles).toContain('A bakery')
  })

  it('falls back to the other half of a pair when a modifier rules one out', () => {
    // Proximity says these are the same place; only one of the two names looks
    // like a museum, so the draft keeps the other rather than losing both.
    const items = [
      save({ user_id: ME, title: 'Museum of tiles', lat: 38.72, lng: -9.11 }),
      save({ user_id: THEM, title: 'The tile place', lat: 38.7201, lng: -9.1101 }),
    ]
    const draft = generateDraft(items, days(2), ME, THEM, { pace: 'normal', skipMuseums: true })
    const titles = draft.days.flatMap((d) => d.items.map((i) => i.title))
    expect(titles).toEqual(['The tile place'])
  })

  it('uses their saves even when you have not voted on them', () => {
    // Verdicts are optional, so most of a real list is unvoted. A generator
    // that only looked at voted-on saves would have nothing to work with.
    const items = [save({ user_id: THEM, title: 'their unvoted pick', lat: 38.72, lng: -9.11 })]
    const draft = generateDraft(items, days(2), ME, THEM, { pace: 'normal' })
    expect(draft.days.flatMap((d) => d.items.map((i) => i.title))).toContain('their unvoted pick')
  })

  it('excludes clashes — one of them already said no', () => {
    const rejected = save({
      user_id: ME,
      title: 'the one they vetoed',
      lat: 38.72,
      lng: -9.11,
      verdicts: [vote(THEM, 'no')],
    })
    const fine = save({ user_id: ME, title: 'fine by both', lat: 38.73, lng: -9.12 })

    const draft = generateDraft([rejected, fine], days(2), ME, THEM, { pace: 'normal' })
    const titles = draft.days.flatMap((d) => d.items.map((i) => i.title))
    expect(titles).not.toContain('the one they vetoed')
    expect(titles).toContain('fine by both')
  })
})
