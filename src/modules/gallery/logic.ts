/**
 * Pure functions for Module 11 — Gallery.
 *
 * Grouping, deduplication, auto-bucketing and the recap. Everything that
 * touches Canvas is in `lib/images.ts`; everything that touches storage is in
 * `api.ts`. What is left is arithmetic over rows, which is what this is.
 */
import { haversineKm, type LatLng } from '@/lib/utils'
import { formatInZone, parseDateOnly, toDateOnly, type DateOnly } from '@/lib/dates'
import type { Media, MediaFilters, MediaGroup, Recap, SameMoment } from './types'

// ---------------------------------------------------------------------------
// Duplicates
// ---------------------------------------------------------------------------

/** Below this Hamming distance, two photos are probably the same (spec 11.3). */
export const DUPLICATE_DISTANCE = 6

/**
 * Bits that differ between two hex-encoded perceptual hashes.
 *
 * Returns null when they cannot be compared — a photo uploaded before hashing
 * existed, or a video. An uncomparable pair is not a duplicate.
 */
export function hammingDistance(a: string | null, b: string | null): number | null {
  if (!a || !b || a.length !== b.length) return null

  let distance = 0
  for (let i = 0; i < a.length; i++) {
    const diff = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16)
    if (Number.isNaN(diff)) return null
    distance += POPCOUNT[diff] ?? 0
  }
  return distance
}

const POPCOUNT = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4]

/**
 * The closest existing photo, if it is close enough to be worth asking about.
 *
 * Spec 11.3 is explicit that this prompts and never auto-rejects. Two photos
 * of the same view seconds apart are not the same photo, and the person who
 * took them is the only one who knows that.
 */
export function findDuplicate(phash: string | null, existing: readonly Media[]): Media | null {
  if (!phash) return null

  let best: { media: Media; distance: number } | null = null
  for (const media of existing) {
    const distance = hammingDistance(phash, media.phash)
    if (distance === null || distance >= DUPLICATE_DISTANCE) continue
    if (!best || distance < best.distance) best = { media, distance }
  }
  return best?.media ?? null
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

/** When a photo happened, best available (spec 11.7's fallback chain). */
export function momentOf(media: Media): string {
  return media.taken_at ?? media.uploaded_at
}

/**
 * The grid's headings: by day, newest first.
 *
 * Days are the viewer's days. A photo taken at 01:00 in Lisbon belongs to a
 * different date depending on who is looking, and spec 0.5 settles that in
 * favour of the viewer.
 */
export function groupByDay(media: readonly Media[], timezone: string): MediaGroup[] {
  const groups = new Map<DateOnly, Media[]>()

  for (const item of media) {
    const day = formatInZone(momentOf(item), timezone, 'yyyy-MM-dd')
    const list = groups.get(day) ?? []
    list.push(item)
    groups.set(day, list)
  }

  return [...groups.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([day, items]) => ({
      key: day,
      label: formatInZone(parseDateOnly(day), 'UTC', 'EEEE d MMMM yyyy'),
      items: items.sort((a, b) => momentOf(b).localeCompare(momentOf(a))),
    }))
}

/** Trip first, then day within it — how the library reads once there are trips. */
export function groupByTrip(
  media: readonly Media[],
  tripTitles: Record<string, string>,
  timezone: string,
): MediaGroup[] {
  const byTrip = new Map<string, Media[]>()
  for (const item of media) {
    const key = item.trip_id ?? 'untripped'
    const list = byTrip.get(key) ?? []
    list.push(item)
    byTrip.set(key, list)
  }

  const groups: MediaGroup[] = []
  const entries = [...byTrip.entries()].sort((a, b) => {
    const newest = (items: Media[]) => items.reduce((max, i) => (momentOf(i) > max ? momentOf(i) : max), '')
    return newest(b[1]).localeCompare(newest(a[1]))
  })

  for (const [tripId, items] of entries) {
    for (const day of groupByDay(items, timezone)) {
      groups.push({
        key: `${tripId}:${day.key}`,
        label:
          tripId === 'untripped'
            ? day.label
            : `${tripTitles[tripId] ?? 'Trip'} · ${day.label}`,
        items: day.items,
      })
    }
  }

  return groups
}

// ---------------------------------------------------------------------------
// Auto-bucketing
// ---------------------------------------------------------------------------

/** Spec 11.4's thresholds: within 500 m and two hours. */
export const BUCKET_RADIUS_KM = 0.5
export const BUCKET_WINDOW_MINUTES = 120

export interface BucketCandidate {
  id: string
  lat: number | null
  lng: number | null
  /** The item's start as an instant, already resolved from trip-local time. */
  startInstant: string | null
}

/**
 * Which itinerary item a photo was probably taken at.
 *
 * Both a place and a time have to agree, because either alone is meaningless:
 * a hotel and a restaurant a street apart are within 500 m of each other all
 * week, and two things two hours apart could be anywhere in a city.
 *
 * Runs after upload and never blocks it. A wrong guess links a photo to the
 * wrong dinner, which is a shrug; a slow upload is not.
 */
export function bucketPhoto(
  photo: Pick<Media, 'lat' | 'lng' | 'taken_at'>,
  candidates: readonly BucketCandidate[],
): string | null {
  if (photo.lat === null || photo.lng === null || !photo.taken_at) return null
  const at = { lat: Number(photo.lat), lng: Number(photo.lng) }
  const takenAt = new Date(photo.taken_at).getTime()

  let best: { id: string; km: number } | null = null

  for (const candidate of candidates) {
    if (candidate.lat === null || candidate.lng === null || !candidate.startInstant) continue

    const minutes = Math.abs(new Date(candidate.startInstant).getTime() - takenAt) / 60_000
    if (minutes > BUCKET_WINDOW_MINUTES) continue

    const km = haversineKm(at, { lat: Number(candidate.lat), lng: Number(candidate.lng) })
    if (km > BUCKET_RADIUS_KM) continue

    if (!best || km < best.km) best = { id: candidate.id, km }
  }

  return best?.id ?? null
}

// ---------------------------------------------------------------------------
// Same-moment pairing
// ---------------------------------------------------------------------------

export const SAME_MOMENT_MINUTES = 3
export const SAME_MOMENT_KM = 0.1

/**
 * Photos the two of them took of the same thing at the same time.
 *
 * The one feature in this module that only makes sense for a couple: within
 * three minutes and a hundred metres, from different people. Shown side by
 * side, because that is a moment they both remember and neither has seen the
 * other's version of.
 */
export function findSameMoments(media: readonly Media[]): SameMoment[] {
  const located = media
    .filter((m) => m.lat !== null && m.lng !== null && m.taken_at)
    .sort((a, b) => momentOf(a).localeCompare(momentOf(b)))

  const pairs: SameMoment[] = []
  const used = new Set<string>()

  for (let i = 0; i < located.length; i++) {
    const a = located[i]!
    if (used.has(a.id)) continue

    for (let j = i + 1; j < located.length; j++) {
      const b = located[j]!
      if (used.has(b.id) || a.uploader_id === b.uploader_id) continue

      const minutes =
        Math.abs(new Date(momentOf(b)).getTime() - new Date(momentOf(a)).getTime()) / 60_000
      // Sorted by time, so once we are past the window nothing later qualifies.
      if (minutes > SAME_MOMENT_MINUTES) break

      const km = haversineKm(
        { lat: Number(a.lat), lng: Number(a.lng) },
        { lat: Number(b.lat), lng: Number(b.lng) },
      )
      if (km > SAME_MOMENT_KM) continue

      pairs.push({
        a,
        b,
        minutesApart: Math.round(minutes),
        metresApart: Math.round(km * 1000),
      })
      used.add(a.id)
      used.add(b.id)
      break
    }
  }

  return pairs
}

// ---------------------------------------------------------------------------
// Daily exchange
// ---------------------------------------------------------------------------

/** Today in the poster's own zone — the date the unique key is built on. */
export function exchangeDateFor(timezone: string, now = new Date()): DateOnly {
  return toDateOnly(new Date(formatInZone(now, timezone, "yyyy-MM-dd'T'00:00:00")))
}

/**
 * The strip, one slot per day, newest first.
 *
 * Empty slots are part of it. A gap is what "we missed a couple of days" looks
 * like, and hiding it would make a broken streak invisible.
 */
export function exchangeStrip(
  entries: readonly { exchange_date: string; user_id: string; media_id: string }[],
  days: readonly DateOnly[],
  selfId: string,
  partnerId: string | null,
): { date: DateOnly; mine: string | null; theirs: string | null }[] {
  const byDate = new Map<string, { mine: string | null; theirs: string | null }>()

  for (const entry of entries) {
    const slot = byDate.get(entry.exchange_date) ?? { mine: null, theirs: null }
    if (entry.user_id === selfId) slot.mine = entry.media_id
    else if (entry.user_id === partnerId) slot.theirs = entry.media_id
    byDate.set(entry.exchange_date, slot)
  }

  return [...days]
    .sort((a, b) => b.localeCompare(a))
    .map((date) => ({ date, ...(byDate.get(date) ?? { mine: null, theirs: null }) }))
}

// ---------------------------------------------------------------------------
// Recap
// ---------------------------------------------------------------------------

/**
 * What a trip looked like, afterwards.
 *
 * Distance is between consecutive photo locations, which is a lower bound on
 * how far they actually moved rather than a claim about it — you only get a
 * point where somebody took a picture.
 */
export function buildRecap(media: readonly Media[]): Recap {
  const ordered = [...media].sort((a, b) => momentOf(a).localeCompare(momentOf(b)))
  const places = ordered
    .filter((m) => m.lat !== null && m.lng !== null)
    .map((m) => ({ lat: Number(m.lat), lng: Number(m.lng), id: m.id }))

  let distanceKm = 0
  for (let i = 1; i < places.length; i++) {
    distanceKm += haversineKm(places[i - 1] as LatLng, places[i] as LatLng)
  }

  return {
    count: ordered.length,
    favourites: ordered.filter((m) => m.is_favorite).length,
    withLocation: places.length,
    distanceKm: Math.round(distanceKm),
    places,
    first: ordered[0] ? momentOf(ordered[0]) : null,
    last: ordered[ordered.length - 1] ? momentOf(ordered[ordered.length - 1]!) : null,
  }
}

// ---------------------------------------------------------------------------
// Filters and budget
// ---------------------------------------------------------------------------

export function hasActiveFilters(filters: MediaFilters): boolean {
  return Boolean(
    filters.tripId ||
      filters.uploaderId ||
      filters.albumId ||
      filters.favouritesOnly ||
      filters.hasLocation ||
      filters.mediaType ||
      filters.from ||
      filters.to ||
      filters.search,
  )
}

/** Spec 11.3: sixty per page. */
export const PAGE_SIZE = 60

/** The free tier, near enough. Used to show how much room is left. */
export const STORAGE_BUDGET_BYTES = 1024 * 1024 * 1024
/** What a processed photo actually costs, from spec 11.4's targets. */
export const BYTES_PER_PHOTO = 340 * 1024

export function photosRemaining(usedBytes: number): number {
  return Math.max(0, Math.floor((STORAGE_BUDGET_BYTES - usedBytes) / BYTES_PER_PHOTO))
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

// ---------------------------------------------------------------------------
// Storage paths
// ---------------------------------------------------------------------------

/**
 * `{couple_id}/{media_id}/{variant}.jpg`.
 *
 * The couple id has to be first: the storage policy reads membership off that
 * segment. Content-addressed by media id, so a variant's path never changes
 * and it can be cached immutably (spec 11.4's egress discipline).
 */
export function mediaPath(coupleId: string, mediaId: string, variant: string): string {
  return `${coupleId}/${mediaId}/${variant}.jpg`
}

/** Signed URLs live this long. Long enough to scroll, short enough to expire. */
export const SIGNED_URL_TTL_SECONDS = 3600
