import { describe, expect, it } from 'vitest'
import {
  BYTES_PER_PHOTO,
  DUPLICATE_DISTANCE,
  STORAGE_BUDGET_BYTES,
  bucketPhoto,
  buildRecap,
  exchangeStrip,
  findDuplicate,
  findSameMoments,
  formatBytes,
  groupByDay,
  groupByTrip,
  hammingDistance,
  hasActiveFilters,
  mediaPath,
  momentOf,
  photosRemaining,
} from '@/modules/gallery/logic'
import type { Media } from '@/modules/gallery/types'

let seq = 0
const media = (over: Partial<Media> = {}): Media => ({
  id: `m${++seq}`,
  couple_id: 'c1',
  uploader_id: 'me',
  trip_id: null,
  itinerary_item_id: null,
  path_display: 'c1/m/display.jpg',
  path_thumb: 'c1/m/thumb.jpg',
  path_original: null,
  thumbhash: null,
  media_type: 'photo',
  mime_type: 'image/jpeg',
  bytes: 340_000,
  width: 1600,
  height: 1200,
  duration_s: null,
  taken_at: '2026-06-01T12:00:00Z',
  lat: null,
  lng: null,
  caption: null,
  is_favorite: false,
  phash: null,
  search_tsv: null,
  uploaded_at: '2026-06-02T09:00:00Z',
  updated_at: '2026-06-02T09:00:00Z',
  deleted_at: null,
  ...over,
})

describe('hammingDistance', () => {
  it('is zero for identical hashes', () => {
    expect(hammingDistance('ff00ff00ff00ff00', 'ff00ff00ff00ff00')).toBe(0)
  })

  it('counts differing bits', () => {
    // 0x0 vs 0xf is four bits.
    expect(hammingDistance('0000000000000000', '000000000000000f')).toBe(4)
  })

  it('refuses to compare what it cannot', () => {
    expect(hammingDistance(null, 'ff')).toBeNull()
    expect(hammingDistance('ff', null)).toBeNull()
    expect(hammingDistance('ff', 'ffff')).toBeNull()
  })
})

describe('findDuplicate', () => {
  const existing = media({ phash: 'ff00ff00ff00ff00' })

  it('finds a near-identical photo', () => {
    // One bit different — the same photo saved twice.
    expect(findDuplicate('ff00ff00ff00ff01', [existing])?.id).toBe(existing.id)
  })

  it('leaves a genuinely different photo alone', () => {
    expect(findDuplicate('0000000000000000', [existing])).toBeNull()
  })

  it('says nothing when the incoming photo has no hash', () => {
    expect(findDuplicate(null, [existing])).toBeNull()
  })

  it('picks the closest of several near matches', () => {
    const closer = media({ phash: 'ff00ff00ff00ff00' })
    const further = media({ phash: 'ff00ff00ff00ff07' })
    expect(findDuplicate('ff00ff00ff00ff00', [further, closer])?.id).toBe(closer.id)
  })

  it('uses the spec’s threshold, not a stricter one', () => {
    // Exactly at the threshold is not a duplicate; below it is.
    const below = 'ff00ff00ff00ff07' // 3 bits
    const at = 'ff00ff00ff00ff3f' // 6 bits
    expect(hammingDistance('ff00ff00ff00ff00', below)! < DUPLICATE_DISTANCE).toBe(true)
    expect(findDuplicate(at, [existing])).toBeNull()
  })
})

describe('groupByDay', () => {
  it('groups by the viewer’s calendar day, newest first', () => {
    const items = [
      media({ taken_at: '2026-06-01T10:00:00Z' }),
      media({ taken_at: '2026-06-02T10:00:00Z' }),
      media({ taken_at: '2026-06-01T18:00:00Z' }),
    ]
    const groups = groupByDay(items, 'UTC')
    expect(groups.map((g) => g.key)).toEqual(['2026-06-02', '2026-06-01'])
    expect(groups[1]!.items).toHaveLength(2)
  })

  it('puts a late-night photo on the viewer’s day, not UTC’s', () => {
    // 23:30 in Lisbon on the 1st is 22:30 UTC — the same day. 00:30 on the 2nd
    // in Lisbon is 23:30 UTC on the 1st, and belongs to the 2nd for them.
    const items = [media({ taken_at: '2026-06-01T23:30:00Z' })]
    expect(groupByDay(items, 'Europe/Lisbon')[0]!.key).toBe('2026-06-02')
    expect(groupByDay(items, 'UTC')[0]!.key).toBe('2026-06-01')
  })

  it('falls back to the upload time when nothing was taken_at', () => {
    const item = media({ taken_at: null, uploaded_at: '2026-07-04T09:00:00Z' })
    expect(momentOf(item)).toBe('2026-07-04T09:00:00Z')
    expect(groupByDay([item], 'UTC')[0]!.key).toBe('2026-07-04')
  })
})

describe('groupByTrip', () => {
  it('labels each day with its trip', () => {
    const items = [
      media({ trip_id: 't1', taken_at: '2026-06-01T10:00:00Z' }),
      media({ trip_id: null, taken_at: '2026-05-01T10:00:00Z' }),
    ]
    const groups = groupByTrip(items, { t1: 'Lisbon' }, 'UTC')
    expect(groups[0]!.label).toContain('Lisbon')
    expect(groups[1]!.label).not.toContain('Lisbon')
  })
})

describe('bucketPhoto', () => {
  const dinner = {
    id: 'i1',
    lat: 38.7205,
    lng: -9.1385,
    startInstant: '2026-06-01T19:00:00Z',
  }

  it('links a photo taken at the right place and time', () => {
    const photo = { lat: 38.7206, lng: -9.1386, taken_at: '2026-06-01T19:30:00Z' }
    expect(bucketPhoto(photo, [dinner])).toBe('i1')
  })

  it('refuses on time alone', () => {
    // Right time, wrong side of the city.
    const photo = { lat: 38.78, lng: -9.2, taken_at: '2026-06-01T19:30:00Z' }
    expect(bucketPhoto(photo, [dinner])).toBeNull()
  })

  it('refuses on place alone', () => {
    // Same restaurant, two days later.
    const photo = { lat: 38.7206, lng: -9.1386, taken_at: '2026-06-03T19:30:00Z' }
    expect(bucketPhoto(photo, [dinner])).toBeNull()
  })

  it('needs coordinates and a time on the photo', () => {
    expect(bucketPhoto({ lat: null, lng: null, taken_at: '2026-06-01T19:30:00Z' }, [dinner])).toBeNull()
    expect(bucketPhoto({ lat: 38.72, lng: -9.13, taken_at: null }, [dinner])).toBeNull()
  })

  it('picks the nearest of two candidates in the window', () => {
    const nearer = { id: 'i2', lat: 38.7205, lng: -9.1385, startInstant: '2026-06-01T19:00:00Z' }
    const further = { id: 'i3', lat: 38.7235, lng: -9.1385, startInstant: '2026-06-01T19:00:00Z' }
    const photo = { lat: 38.7206, lng: -9.1386, taken_at: '2026-06-01T19:10:00Z' }
    expect(bucketPhoto(photo, [further, nearer])).toBe('i2')
  })
})

describe('findSameMoments', () => {
  it('pairs two people photographing the same thing', () => {
    const mine = media({
      uploader_id: 'me',
      lat: 38.7205,
      lng: -9.1385,
      taken_at: '2026-06-01T19:00:00Z',
    })
    const theirs = media({
      uploader_id: 'them',
      lat: 38.7206,
      lng: -9.1386,
      taken_at: '2026-06-01T19:01:00Z',
    })

    const pairs = findSameMoments([mine, theirs])
    expect(pairs).toHaveLength(1)
    expect(pairs[0]!.minutesApart).toBe(1)
    expect(pairs[0]!.metresApart).toBeLessThan(100)
  })

  it('does not pair one person with themselves', () => {
    const first = media({
      uploader_id: 'me',
      lat: 38.72,
      lng: -9.13,
      taken_at: '2026-06-01T19:00:00Z',
    })
    const second = media({
      uploader_id: 'me',
      lat: 38.72,
      lng: -9.13,
      taken_at: '2026-06-01T19:01:00Z',
    })
    expect(findSameMoments([first, second])).toHaveLength(0)
  })

  it('does not pair across a gap in time or space', () => {
    const mine = media({
      uploader_id: 'me',
      lat: 38.72,
      lng: -9.13,
      taken_at: '2026-06-01T19:00:00Z',
    })
    const later = media({
      uploader_id: 'them',
      lat: 38.72,
      lng: -9.13,
      taken_at: '2026-06-01T19:30:00Z',
    })
    const elsewhere = media({
      uploader_id: 'them',
      lat: 38.9,
      lng: -9.13,
      taken_at: '2026-06-01T19:01:00Z',
    })

    expect(findSameMoments([mine, later])).toHaveLength(0)
    expect(findSameMoments([mine, elsewhere])).toHaveLength(0)
  })

  it('uses each photo in at most one pair', () => {
    const mine = media({
      uploader_id: 'me',
      lat: 38.72,
      lng: -9.13,
      taken_at: '2026-06-01T19:00:00Z',
    })
    const theirs1 = media({
      uploader_id: 'them',
      lat: 38.72,
      lng: -9.13,
      taken_at: '2026-06-01T19:01:00Z',
    })
    const theirs2 = media({
      uploader_id: 'them',
      lat: 38.72,
      lng: -9.13,
      taken_at: '2026-06-01T19:02:00Z',
    })
    expect(findSameMoments([mine, theirs1, theirs2])).toHaveLength(1)
  })
})

describe('exchangeStrip', () => {
  it('keeps the empty days, because a gap is the information', () => {
    const entries = [
      { exchange_date: '2026-06-01', user_id: 'me', media_id: 'm1' },
      { exchange_date: '2026-06-01', user_id: 'them', media_id: 'm2' },
      { exchange_date: '2026-06-03', user_id: 'me', media_id: 'm3' },
    ]
    const strip = exchangeStrip(entries, ['2026-06-01', '2026-06-02', '2026-06-03'], 'me', 'them')

    expect(strip.map((s) => s.date)).toEqual(['2026-06-03', '2026-06-02', '2026-06-01'])
    expect(strip[0]).toEqual({ date: '2026-06-03', mine: 'm3', theirs: null })
    expect(strip[1]).toEqual({ date: '2026-06-02', mine: null, theirs: null })
    expect(strip[2]).toEqual({ date: '2026-06-01', mine: 'm1', theirs: 'm2' })
  })
})

describe('buildRecap', () => {
  it('sums the distance between consecutive photo locations', () => {
    const items = [
      media({ lat: 38.72, lng: -9.13, taken_at: '2026-06-01T10:00:00Z' }),
      media({ lat: 38.73, lng: -9.13, taken_at: '2026-06-01T12:00:00Z' }),
      media({ lat: 38.74, lng: -9.13, taken_at: '2026-06-01T14:00:00Z' }),
    ]
    const recap = buildRecap(items)
    expect(recap.count).toBe(3)
    expect(recap.withLocation).toBe(3)
    expect(recap.distanceKm).toBeGreaterThan(1)
    expect(recap.first).toBe('2026-06-01T10:00:00Z')
    expect(recap.last).toBe('2026-06-01T14:00:00Z')
  })

  it('copes with photos that have no location', () => {
    const recap = buildRecap([media(), media({ is_favorite: true })])
    expect(recap.withLocation).toBe(0)
    expect(recap.distanceKm).toBe(0)
    expect(recap.favourites).toBe(1)
  })

  it('is empty for an empty trip', () => {
    expect(buildRecap([])).toMatchObject({ count: 0, distanceKm: 0, first: null, last: null })
  })
})

describe('the storage budget', () => {
  it('works out how many more photos fit', () => {
    // The number the whole module is designed around: ~2,900 in a gigabyte.
    expect(photosRemaining(0)).toBeGreaterThan(2800)
    expect(photosRemaining(0)).toBeLessThan(3200)
  })

  it('never goes negative when the budget is blown', () => {
    expect(photosRemaining(STORAGE_BUDGET_BYTES + BYTES_PER_PHOTO)).toBe(0)
  })

  it('formats sizes the way a person reads them', () => {
    expect(formatBytes(900)).toBe('900 B')
    expect(formatBytes(40 * 1024)).toBe('40 KB')
    expect(formatBytes(340 * 1024)).toBe('340 KB')
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB')
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.00 GB')
  })
})

describe('mediaPath', () => {
  it('puts the couple id first, which is what the storage policy reads', () => {
    expect(mediaPath('couple-1', 'media-1', 'thumb')).toBe('couple-1/media-1/thumb.jpg')
  })
})

describe('hasActiveFilters', () => {
  it('knows the difference between no filter and a filter', () => {
    expect(hasActiveFilters({})).toBe(false)
    expect(hasActiveFilters({ tripId: null, search: null })).toBe(false)
    expect(hasActiveFilters({ favouritesOnly: true })).toBe(true)
    expect(hasActiveFilters({ search: 'beach' })).toBe(true)
  })
})
