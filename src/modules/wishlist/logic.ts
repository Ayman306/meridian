/**
 * Pure functions for Module 7 — Wishlist & Blend.
 *
 * Two things live here. The first is place matching: deciding that a restaurant
 * one of them saved from Instagram and the other from a blog is the same
 * restaurant. The second is the draft generator, which is plain TypeScript with
 * no model behind it — the spec is explicit that the app works with AI disabled,
 * and this is the feature that would otherwise need it.
 */
import { haversineKm } from '@/lib/utils'
import { LONG_STAY_NIGHTS } from '@/lib/constants'
import type { DateOnly } from '@/lib/dates'
import type {
  BlendGroups,
  Draft,
  DraftDay,
  DraftOptions,
  MatchedPair,
  Pace,
  Verdict,
  WishlistItem,
  WishlistItemWithVerdicts,
} from './types'

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/** 150m catches the same restaurant saved from two different sources. */
const SAME_PLACE_METRES = 150

/**
 * Strip a title down to what is actually distinctive: case, punctuation and a
 * leading article are all noise when comparing "The Ivy" with "ivy".
 */
export function normaliseTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/^(the|a|le|la|el)/, '')
}

export function isSamePlace(a: WishlistItem, b: WishlistItem): 'proximity' | 'name' | null {
  if (a.lat !== null && a.lng !== null && b.lat !== null && b.lng !== null) {
    const metres =
      haversineKm(
        { lat: Number(a.lat), lng: Number(a.lng) },
        { lat: Number(b.lat), lng: Number(b.lng) },
      ) * 1000
    if (metres < SAME_PLACE_METRES) return 'proximity'
  }

  // Without coordinates, the name has to carry it — but only within one city,
  // because "Central Park" exists in more places than you would think.
  if (normaliseTitle(a.title) === normaliseTitle(b.title) && a.city === b.city) {
    return 'name'
  }

  return null
}

// ---------------------------------------------------------------------------
// The blend
// ---------------------------------------------------------------------------

function verdictOf(item: WishlistItemWithVerdicts, userId: string): Verdict | null {
  return (item.verdicts.find((v) => v.user_id === userId)?.verdict as Verdict) ?? null
}

/**
 * Split every save into the five sections the blend view shows.
 *
 * "Both of us" is computed rather than declared: neither of them said they
 * agreed, they just both happened to save the same place. That coincidence is
 * the most interesting thing on the screen, which is why it goes first.
 */
export function buildBlend(
  items: readonly WishlistItemWithVerdicts[],
  selfId: string,
  partnerId: string | null,
): BlendGroups {
  const live = items.filter((i) => !i.deleted_at)
  const mine = live.filter((i) => i.user_id === selfId)
  const theirs = partnerId ? live.filter((i) => i.user_id === partnerId) : []

  const both: MatchedPair[] = []
  const matchedMine = new Set<string>()
  const matchedTheirs = new Set<string>()

  for (const a of mine) {
    for (const b of theirs) {
      if (matchedTheirs.has(b.id)) continue
      const how = isSamePlace(a, b)
      if (how) {
        both.push({ items: [a, b], matchedBy: how })
        matchedMine.add(a.id)
        matchedTheirs.add(b.id)
        break
      }
    }
  }

  const unmatchedMine = mine.filter((i) => !matchedMine.has(i.id))
  const unmatchedTheirs = theirs.filter((i) => !matchedTheirs.has(i.id))

  // A clash is one person's save that the other actively rejected. It stays
  // visible: knowing you disagree is more useful than hiding the disagreement.
  const clashes = [
    ...unmatchedMine.filter((i) => partnerId && verdictOf(i, partnerId) === 'no'),
    ...unmatchedTheirs.filter((i) => verdictOf(i, selfId) === 'no'),
  ]
  const clashIds = new Set(clashes.map((i) => i.id))

  // Undecided is only ever about *their* saves — you are not waiting on
  // yourself, and an unvoted list is a perfectly fine state to be in.
  const undecided = unmatchedTheirs.filter(
    (i) => !clashIds.has(i.id) && verdictOf(i, selfId) === null,
  )
  const undecidedIds = new Set(undecided.map((i) => i.id))

  return {
    both,
    mine: byIntensity(unmatchedMine.filter((i) => !clashIds.has(i.id))),
    theirs: byIntensity(
      unmatchedTheirs.filter((i) => !clashIds.has(i.id) && !undecidedIds.has(i.id)),
    ),
    clashes,
    undecided: byIntensity(undecided),
  }
}

function byIntensity<T extends WishlistItem>(items: T[]): T[] {
  return [...items].sort((a, b) => (b.intensity ?? 0) - (a.intensity ?? 0))
}

/** Saves grouped by city, with the city-less ones under "Unfiled". */
export function groupByCity<T extends WishlistItem>(items: readonly T[]): Record<string, T[]> {
  const groups: Record<string, T[]> = {}
  for (const item of items) {
    if (item.deleted_at) continue
    const key = item.city?.trim() || 'Unfiled'
    ;(groups[key] ??= []).push(item)
  }
  return groups
}

// ---------------------------------------------------------------------------
// The draft generator (spec 7.3) — no model, just arithmetic
// ---------------------------------------------------------------------------

/** Items and anchors per day, by pace. */
const CAPACITY: Record<Pace, { items: number; anchors: number }> = {
  relaxed: { items: 2, anchors: 1 },
  normal: { items: 4, anchors: 1 },
  packed: { items: 6, anchors: 2 },
}

/** On a long stay the generator plans at most this share of the days. */
const LONG_STAY_FILL_RATIO = 0.4

/**
 * What "skip museums" matches.
 *
 * Titles are whatever the place calls itself, which in the cities this app is
 * for means the local word — a modifier that only knew the English one would
 * quietly do nothing in exactly the places you would use it.
 */
const SKIP_MUSEUMS = /\b(museum|museu|musée|museo|gallery|galeria|galerie|galleria)\b/i

/** Titles the "more food" modifier biases towards. */
const FOOD_WORDS = /\b(food|eat|restaurant|café|cafe|bar|dinner|lunch|bakery|padaria|taberna)\b/i

export function generateDraft(
  items: readonly WishlistItemWithVerdicts[],
  days: readonly DateOnly[],
  selfId: string,
  partnerId: string | null,
  opts: DraftOptions,
): Draft {
  if (days.length === 0) {
    return { days: [], openDays: [], note: 'Set the trip dates and I can lay something out.' }
  }

  // On a stay longer than five nights, blank days are the point of the trip.
  // Filling a month would be the single worst thing this feature could do, so
  // it plans 40% at most and says so.
  const isLongStay = days.length - 1 > LONG_STAY_NIGHTS
  const plannableCount = isLongStay
    ? Math.max(1, Math.floor(days.length * LONG_STAY_FILL_RATIO))
    : days.length

  const capacity = CAPACITY[opts.pace]
  const selected = selectItems(items, selfId, partnerId, plannableCount * capacity.items, opts)

  if (selected.length === 0) {
    return {
      days: [],
      openDays: [...days],
      note: 'Nothing saved yet for this trip — add a few places and try again.',
    }
  }

  // Spread the planned days through the trip rather than front-loading them,
  // and leave the first and last light (spec 5.3 pacing).
  const plannableDays = pickSpreadDays(days, plannableCount)
  const clusters = clusterByLocation(selected, plannableDays.length)

  const draftDays: DraftDay[] = []
  clusters.forEach((cluster, i) => {
    const date = plannableDays[i]
    if (!date || cluster.length === 0) return
    const ordered = orderByProximity(cluster)
    const paced = applyPacing(ordered, capacity)
    if (paced.length > 0) draftDays.push({ date, items: paced })
  })

  const balanced = balanceAuthorship(draftDays, selfId)
  const planned = new Set(balanced.map((d) => d.date))

  return {
    days: balanced,
    openDays: days.filter((d) => !planned.has(d)),
    note: isLongStay
      ? `Planned ${balanced.length} of ${days.length} days. On a stay this long the open days are the point — they are left alone deliberately.`
      : `Planned ${balanced.length} ${balanced.length === 1 ? 'day' : 'days'}. Nothing is in your itinerary yet.`,
  }
}

/**
 * What goes in: everything they both saved, then anything either felt strongly
 * about, then alternating picks so neither person's list dominates.
 */
function selectItems(
  items: readonly WishlistItemWithVerdicts[],
  selfId: string,
  partnerId: string | null,
  limit: number,
  opts: DraftOptions,
): WishlistItemWithVerdicts[] {
  const blend = buildBlend(items, selfId, partnerId)
  const chosen: WishlistItemWithVerdicts[] = []
  const seen = new Set<string>()

  const take = (item: WishlistItemWithVerdicts | undefined): boolean => {
    if (!item || seen.has(item.id) || chosen.length >= limit) return false
    if (opts.skipMuseums && SKIP_MUSEUMS.test(item.title)) return false
    seen.add(item.id)
    chosen.push(item)
    return true
  }

  // Agreed picks first — these are the safest thing in the whole list. When a
  // modifier rules out one half of a pair, try the other: the two are the same
  // place described twice, and the version that survives the filter is the one
  // worth keeping.
  for (const pair of blend.both) {
    if (!take(pair.items[0])) take(pair.items[1])
  }

  // Their saves you have not voted on count as theirs. Verdicts are optional
  // (spec 7.2), so "undecided" is the state most of a real list is in — a
  // generator that ignored it would have almost nothing to work with.
  const theirSide = [...blend.theirs, ...blend.undecided]
  const everything = [...blend.mine, ...theirSide]

  // Then anything either of them rated 5.
  for (const item of everything) {
    if (item.intensity === 5) take(item)
  }

  if (opts.moreFood) {
    for (const item of everything) {
      if (FOOD_WORDS.test(item.title)) take(item)
    }
  }

  // Then alternate, so the draft does not become one person's weekend.
  const mine = blend.mine.filter((i) => !seen.has(i.id))
  const theirs = theirSide.filter((i) => !seen.has(i.id))
  for (let i = 0; i < Math.max(mine.length, theirs.length); i++) {
    take(mine[i])
    take(theirs[i])
  }

  // Clashes are excluded on purpose: one of them already said no.
  return chosen
}

/**
 * Days to plan, spread across the trip.
 *
 * Arrival and departure days are skipped where there is room — nobody wants a
 * museum booked for the afternoon they land.
 */
export function pickSpreadDays(days: readonly DateOnly[], count: number): DateOnly[] {
  if (count >= days.length) return [...days]

  const inner = days.length > 2 ? days.slice(1, -1) : [...days]
  const pool = inner.length >= count ? inner : [...days]

  const step = pool.length / count
  const picked: DateOnly[] = []
  for (let i = 0; i < count; i++) {
    const day = pool[Math.floor(i * step)]
    if (day && !picked.includes(day)) picked.push(day)
  }
  return picked
}

/**
 * k-means on coordinates, so each day covers one part of town rather than
 * criss-crossing the city.
 *
 * Items without coordinates cannot be clustered spatially, so they are dealt
 * round-robin afterwards (spec 7.6: fall back rather than dropping them).
 */
export function clusterByLocation(
  items: readonly WishlistItemWithVerdicts[],
  k: number,
): WishlistItemWithVerdicts[][] {
  const clusters: WishlistItemWithVerdicts[][] = Array.from({ length: k }, () => [])
  if (k === 0) return clusters

  const placed = items.filter((i) => i.lat !== null && i.lng !== null)
  const unplaced = items.filter((i) => i.lat === null || i.lng === null)

  if (placed.length === 0) {
    unplaced.forEach((item, i) => clusters[i % k]!.push(item))
    return clusters
  }

  // Seed the centroids by spreading over the sorted-by-longitude list rather
  // than at random, so the same input always produces the same draft. A
  // generator that gives a different answer each time is hard to trust.
  const sorted = [...placed].sort((a, b) => Number(a.lng) - Number(b.lng))
  let centroids = Array.from({ length: k }, (_, i) => {
    const item = sorted[Math.floor((i * sorted.length) / k)] ?? sorted[0]!
    return { lat: Number(item.lat), lng: Number(item.lng) }
  })

  for (let iteration = 0; iteration < 12; iteration++) {
    for (const c of clusters) c.length = 0

    for (const item of placed) {
      const point = { lat: Number(item.lat), lng: Number(item.lng) }
      let best = 0
      let bestDistance = Infinity
      centroids.forEach((centroid, i) => {
        const d = haversineKm(point, centroid)
        if (d < bestDistance) {
          bestDistance = d
          best = i
        }
      })
      clusters[best]!.push(item)
    }

    const moved = centroids.map((centroid, i) => {
      const members = clusters[i]!
      if (members.length === 0) return centroid
      return {
        lat: members.reduce((s, m) => s + Number(m.lat), 0) / members.length,
        lng: members.reduce((s, m) => s + Number(m.lng), 0) / members.length,
      }
    })

    const settled = moved.every(
      (c, i) => Math.abs(c.lat - centroids[i]!.lat) < 1e-6 && Math.abs(c.lng - centroids[i]!.lng) < 1e-6,
    )
    centroids = moved
    if (settled) break
  }

  // Spread the placeless items across the emptiest days.
  unplaced.forEach((item) => {
    const smallest = clusters.reduce((a, b) => (a.length <= b.length ? a : b))
    smallest.push(item)
  })

  return clusters
}

/**
 * Nearest-neighbour ordering, then a 2-opt pass to undo the worst crossings.
 * n is single digits here, so the cost is irrelevant and the improvement is
 * visible on a map.
 */
export function orderByProximity(
  items: readonly WishlistItemWithVerdicts[],
): WishlistItemWithVerdicts[] {
  const placed = items.filter((i) => i.lat !== null && i.lng !== null)
  const unplaced = items.filter((i) => i.lat === null || i.lng === null)
  if (placed.length < 2) return [...placed, ...unplaced]

  const remaining = [...placed]
  const route = [remaining.shift()!]

  while (remaining.length > 0) {
    const last = route[route.length - 1]!
    let bestIndex = 0
    let bestDistance = Infinity
    remaining.forEach((candidate, i) => {
      const d = distanceBetween(last, candidate)
      if (d < bestDistance) {
        bestDistance = d
        bestIndex = i
      }
    })
    route.push(remaining.splice(bestIndex, 1)[0]!)
  }

  return [...twoOpt(route), ...unplaced]
}

function twoOpt(route: WishlistItemWithVerdicts[]): WishlistItemWithVerdicts[] {
  let best = [...route]
  let improved = true

  while (improved) {
    improved = false
    for (let i = 1; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const candidate = [...best.slice(0, i), ...best.slice(i, j + 1).reverse(), ...best.slice(j + 1)]
        if (routeLength(candidate) < routeLength(best) - 1e-9) {
          best = candidate
          improved = true
        }
      }
    }
  }

  return best
}

function routeLength(route: readonly WishlistItemWithVerdicts[]): number {
  let total = 0
  for (let i = 0; i < route.length - 1; i++) total += distanceBetween(route[i]!, route[i + 1]!)
  return total
}

function distanceBetween(a: WishlistItem, b: WishlistItem): number {
  return haversineKm(
    { lat: Number(a.lat), lng: Number(a.lng) },
    { lat: Number(b.lat), lng: Number(b.lng) },
  )
}

/**
 * Trim a day to its capacity, and refuse to put three of the same kind in a
 * row. The category rule is what stops a day being breakfast, lunch, dinner.
 */
export function applyPacing(
  items: readonly WishlistItemWithVerdicts[],
  capacity: { items: number; anchors: number },
): WishlistItemWithVerdicts[] {
  const out: WishlistItemWithVerdicts[] = []
  const deferred: WishlistItemWithVerdicts[] = []

  for (const item of items) {
    if (out.length >= capacity.items) break

    const lastTwo = out.slice(-2)
    const wouldBeThree =
      lastTwo.length === 2 &&
      item.category_id !== null &&
      lastTwo.every((p) => p.category_id === item.category_id)

    if (wouldBeThree) {
      deferred.push(item)
      continue
    }
    out.push(item)
  }

  // A deferred item can still fit if something else broke the run.
  for (const item of deferred) {
    if (out.length >= capacity.items) break
    const lastTwo = out.slice(-2)
    const wouldBeThree =
      lastTwo.length === 2 &&
      item.category_id !== null &&
      lastTwo.every((p) => p.category_id === item.category_id)
    if (!wouldBeThree) out.push(item)
  }

  return out
}

/**
 * Alternate whose pick opens each day.
 *
 * A draft where one person's saves lead every morning reads as the app taking
 * sides, even when the split is even overall.
 */
export function balanceAuthorship(days: readonly DraftDay[], selfId: string): DraftDay[] {
  let preferSelf = true

  return days.map((day) => {
    const opener = day.items.findIndex((i) =>
      preferSelf ? i.user_id === selfId : i.user_id !== selfId,
    )
    preferSelf = !preferSelf

    if (opener <= 0) return day
    const reordered = [...day.items]
    const [moved] = reordered.splice(opener, 1)
    return { ...day, items: [moved!, ...reordered] }
  })
}
