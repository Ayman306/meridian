/**
 * Pure functions for Module 4 — Destinations.
 *
 * The board is a comparison, not a recommendation. Everything here computes a
 * fact and hands it over; nothing decides. The one thing that looks like a
 * judgement — the score — is off by default and always shows its working.
 */
import { haversineKm, type LatLng } from '@/lib/utils'
import { zoneFor } from '@/lib/zones'
import { seasonBand, BAND_SCORE, type Band } from './climate'
import { costBand as costBandOf } from './cost'
import type {
  BoardColumn,
  Fairness,
  FlightEstimate,
  PersonView,
  ScoreBreakdown,
  ScoreWeights,
  TripDestination,
  VisaRule,
  VisaTier,
} from './types'

// ---------------------------------------------------------------------------
// Visa
// ---------------------------------------------------------------------------

/** Spec 4.3. Higher is more friction; 5 excludes the destination entirely. */
export const VISA_FRICTION: Record<VisaTier, number> = {
  0: 0,
  1: 2,
  2: 4,
  3: 12,
  4: 20,
  5: Number.POSITIVE_INFINITY,
}

export const VISA_TIER_LABELS: Record<VisaTier, string> = {
  0: 'Visa-free',
  1: 'eVisa or ETA',
  2: 'Visa on arrival',
  3: 'Embassy appointment',
  4: 'Difficult — long lead time',
  5: 'Effectively unavailable',
}

/**
 * The disclaimer that must appear wherever a visa or allowance rule is shown.
 *
 * Exported as a constant rather than typed into each component so it cannot
 * drift, and so a search for its name finds every surface that carries it.
 */
export const VISA_DISCLAIMER = 'Advisory only — confirm with the embassy.'

/**
 * Dual nationality: compute both, show the better one, say which (spec 4.6).
 *
 * "Better" is lower friction. Ties go to the first passport listed, which is
 * the profile's primary — if both routes are equally easy, the one they think
 * of as theirs is the one to name.
 */
export function bestVisaRule(
  rules: readonly VisaRule[],
  passports: readonly (string | null | undefined)[],
  destinationCountry: string | null,
  zone: string | null,
): { rule: VisaRule | null; passport: string | null } {
  if (!destinationCountry) return { rule: null, passport: null }

  let best: { rule: VisaRule; passport: string } | null = null

  for (const passport of passports) {
    if (!passport) continue
    const rule = findVisaRule(rules, passport, destinationCountry, zone)
    if (!rule) continue
    if (!best || VISA_FRICTION[rule.tier as VisaTier] < VISA_FRICTION[best.rule.tier as VisaTier]) {
      best = { rule, passport: passport.toUpperCase() }
    }
  }

  return best ? { rule: best.rule, passport: best.passport } : { rule: null, passport: null }
}

/** A country-specific rule wins over its zone's rule. */
export function findVisaRule(
  rules: readonly VisaRule[],
  passport: string,
  destinationCountry: string,
  zone: string | null,
): VisaRule | null {
  const p = passport.toUpperCase()
  const d = destinationCountry.toUpperCase()
  return (
    rules.find((r) => r.passport_country === p && r.destination_country === d) ??
    (zone ? (rules.find((r) => r.passport_country === p && r.destination_country === zone) ?? null) : null)
  )
}

/** Combined friction across both partners, per spec 4.3. */
export function combinedFriction(views: readonly PersonView[]): number {
  return views.reduce((total, view) => {
    if (view.isHome) return total
    // An unknown rule is not zero friction. Treating a missing row as
    // visa-free is exactly the mistake this module exists to prevent, so it
    // costs as much as an embassy appointment until someone checks.
    if (!view.visa) return total + VISA_FRICTION[3]
    return total + VISA_FRICTION[view.visa.tier as VisaTier]
  }, 0)
}

/** Why a candidate is out, or null when it is still in play. */
export function exclusionReason(views: readonly PersonView[]): string | null {
  const blocked = views.find((v) => !v.isHome && v.visa?.tier === 5)
  if (!blocked) return null
  return `${blocked.visa?.label ?? 'Entry is effectively unavailable'} on this passport.`
}

// ---------------------------------------------------------------------------
// Flights
// ---------------------------------------------------------------------------

/**
 * Spec 4.3: the cache first, a great circle second, and the two must look
 * different on screen. An estimate presented as a fact is how someone books a
 * connection that does not exist.
 */
export function flightEstimate(
  from: LatLng | null,
  to: LatLng | null,
  cached: number | null,
): FlightEstimate | null {
  if (cached !== null) return { hours: round1(cached / 60), isEstimated: false }
  if (!from || !to) return null

  const km = haversineKm(from, to)
  // 30 minutes of taxi and climb, then 800 km/h cruise.
  const minutes = 30 + (km / 800) * 60
  return { hours: round1(minutes / 60), isEstimated: true }
}

// ---------------------------------------------------------------------------
// Fairness
// ---------------------------------------------------------------------------

/**
 * How evenly the journey is split. Spec 4.3's bands exactly.
 *
 * Rendered as a two-sided bar rather than a number, and it names who is
 * travelling further — "skewed" with no direction is not information.
 */
export function fairness(views: readonly PersonView[]): Fairness | null {
  const withFlights = views.filter((v) => v.flight !== null)
  if (withFlights.length < 2) return null

  const [a, b] = withFlights as [PersonView, PersonView]
  const hoursA = a.flight!.hours
  const hoursB = b.flight!.hours
  const diff = Math.abs(hoursA - hoursB)

  const kind = diff < 2 ? 'balanced' : diff < 5 ? 'slight' : diff < 10 ? 'skewed' : 'heavy'
  const towards = diff === 0 ? null : hoursA > hoursB ? a.userId : b.userId

  return { kind, diff: round1(diff), towards }
}

/** The equal-distance lens (spec 4.2): fairness alone, no cost implication. */
export function isEqualDistance(column: BoardColumn): boolean {
  return column.fairness !== null && column.fairness.diff < 2
}

// ---------------------------------------------------------------------------
// Season
// ---------------------------------------------------------------------------

/**
 * The month the trip actually happens in, or null.
 *
 * Only exact dates get a season: a trip pinned to "2027" has a `start_date` of
 * January 1st, and answering "January" for it would be a fact invented out of
 * a placeholder.
 */
export function tripMonth(
  startDate: string | null,
  precision: string | null,
): number | null {
  if (!startDate || precision === 'unknown' || precision === 'year' || precision === 'season') {
    return null
  }
  const month = Number(startDate.slice(5, 7))
  return Number.isFinite(month) && month >= 1 && month <= 12 ? month : null
}

export function bandFor(countryCode: string | null, month: number | null): Band | null {
  return seasonBand(countryCode, month)
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export const ZERO_WEIGHTS: ScoreWeights = {
  hours: 0,
  fairness: 0,
  visa: 0,
  season: 0,
  cost: 0,
  wishlist: 0,
}

/** Ranking appears only once someone has asked for it (spec 4.2). */
export function scoringEnabled(weights: ScoreWeights): boolean {
  return Object.values(weights).some((w) => w > 0)
}

export function parseWeights(raw: unknown): ScoreWeights {
  if (!raw || typeof raw !== 'object') return ZERO_WEIGHTS
  const source = raw as Record<string, unknown>
  const read = (key: keyof ScoreWeights) => {
    const value = Number(source[key])
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
  }
  return {
    hours: read('hours'),
    fairness: read('fairness'),
    visa: read('visa'),
    season: read('season'),
    cost: read('cost'),
    wishlist: read('wishlist'),
  }
}

/**
 * Score every column against the current candidate set.
 *
 * Each input is normalised to 0..1 *across the candidates on screen*, so the
 * numbers say "compared to these five", never "out of ten in the world". A
 * single candidate therefore scores the same on every axis, which is correct:
 * there is nothing to compare it with.
 *
 * The breakdown comes back with the total because spec 4.3 forbids a bare
 * number, and rightly — a destination "scoring 0.72" tells nobody anything.
 */
export function scoreColumns(
  columns: readonly BoardColumn[],
  weights: ScoreWeights,
  costBand: (countryCode: string | null) => number | null,
): (ScoreBreakdown | null)[] {
  if (!scoringEnabled(weights)) return columns.map(() => null)

  const hours = columns.map((c) => totalHours(c))
  const diffs = columns.map((c) => c.fairness?.diff ?? null)
  const friction = columns.map((c) => finiteFriction(c))
  const seasons = columns.map((c) => (c.band ? BAND_SCORE[c.band] : null))
  const costs = columns.map((c) => costBand(c.destination.country_code))
  const wishes = columns.map((c) => c.wishlistCount)

  // Lower is better for the first three, so they are inverted after scaling.
  const normHours = invert(normalise(hours))
  const normFair = invert(normalise(diffs))
  const normVisa = invert(normalise(friction))
  const normSeason = normalise(seasons)
  const normCost = invert(normalise(costs))
  const normWish = normalise(wishes.map((w) => w))

  return columns.map((_, i) => {
    const axes: { key: keyof ScoreWeights; weight: number; value: number }[] = [
      { key: 'hours', weight: weights.hours, value: normHours[i]! },
      { key: 'fairness', weight: weights.fairness, value: normFair[i]! },
      { key: 'visa', weight: weights.visa, value: normVisa[i]! },
      { key: 'season', weight: weights.season, value: normSeason[i]! },
      { key: 'cost', weight: weights.cost, value: normCost[i]! },
      { key: 'wishlist', weight: weights.wishlist, value: normWish[i]! },
    ]
    const parts: ScoreBreakdown['parts'] = axes.map((p) => ({
      ...p,
      contribution: p.weight * p.value,
    }))

    const weightTotal = parts.reduce((sum, p) => sum + p.weight, 0)
    const raw = parts.reduce((sum, p) => sum + p.contribution, 0)
    // Divided by the weights in play, so the number reads 0..1 whether one
    // slider is up or all six are.
    return { total: weightTotal > 0 ? raw / weightTotal : 0, parts }
  })
}

function totalHours(column: BoardColumn): number | null {
  const flights = column.people.map((p) => p.flight?.hours).filter((h): h is number => h != null)
  return flights.length === 0 ? null : flights.reduce((a, b) => a + b, 0)
}

function finiteFriction(column: BoardColumn): number | null {
  const value = combinedFriction(column.people)
  return Number.isFinite(value) ? value : null
}

/**
 * Scale to 0..1 across the set. A missing value scores 0.5 — the middle, so an
 * unknown neither rewards nor punishes a candidate. All-equal scores 1, since
 * no candidate is worse than another on an axis where they match.
 */
export function normalise(values: readonly (number | null)[]): number[] {
  const known = values.filter((v): v is number => v !== null)
  if (known.length === 0) return values.map(() => 0.5)

  const min = Math.min(...known)
  const max = Math.max(...known)
  const span = max - min

  return values.map((v) => (v === null ? 0.5 : span === 0 ? 1 : (v - min) / span))
}

function invert(values: readonly number[]): number[] {
  return values.map((v) => 1 - v)
}

export function rankColumns(columns: readonly BoardColumn[]): BoardColumn[] {
  return [...columns].sort((a, b) => (b.score?.total ?? -1) - (a.score?.total ?? -1))
}

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

export interface Traveller {
  userId: string
  home: LatLng | null
  /** Primary first — it wins ties when both passports give the same tier. */
  passports: (string | null)[]
}

export interface BoardInput {
  destinations: readonly TripDestination[]
  travellers: readonly Traveller[]
  visaRules: readonly VisaRule[]
  /** Cached durations keyed `ORIGIN>DEST`, or by coordinates when no IATA. */
  routeMinutes?: (destination: TripDestination, traveller: Traveller) => number | null
  wishlistCountFor: (destination: TripDestination) => number
  month: number | null
  weights: ScoreWeights
}

/**
 * Everything the comparison board shows, for every candidate at once.
 *
 * One function rather than a column-at-a-time loop because scoring normalises
 * across the set: a column cannot know its own score without seeing its rivals.
 */
export function buildBoard(input: BoardInput): BoardColumn[] {
  const columns: BoardColumn[] = input.destinations.map((destination) => {
    const zone = zoneFor(destination.country_code)
    const to =
      destination.lat !== null && destination.lng !== null
        ? { lat: Number(destination.lat), lng: Number(destination.lng) }
        : null

    const people: PersonView[] = input.travellers.map((traveller) => {
      const passports = traveller.passports.filter(Boolean) as string[]
      const isHome = Boolean(
        destination.country_code &&
          passports.some((p) => p.toUpperCase() === destination.country_code!.toUpperCase()),
      )
      const { rule, passport } = isHome
        ? { rule: null, passport: null }
        : bestVisaRule(input.visaRules, passports, destination.country_code, zone)

      return {
        userId: traveller.userId,
        flight: flightEstimate(
          traveller.home,
          to,
          input.routeMinutes?.(destination, traveller) ?? null,
        ),
        visa: rule,
        isHome,
        passport,
      }
    })

    return {
      destination,
      people,
      fairness: fairness(people),
      band: bandFor(destination.country_code, input.month),
      wishlistCount: input.wishlistCountFor(destination),
      excluded: exclusionReason(people),
      score: null,
    }
  })

  const scores = scoreColumns(columns, input.weights, costBandOf)
  return columns.map((column, i) => ({ ...column, score: scores[i]! }))
}

// ---------------------------------------------------------------------------
// Ordering and display
// ---------------------------------------------------------------------------

/** Chosen first, then candidates, then rejections — which stay visible. */
export function sortDestinations(destinations: readonly TripDestination[]): TripDestination[] {
  const rank = { chosen: 0, candidate: 1, rejected: 2 } as const
  return [...destinations].sort((a, b) => {
    const byState =
      (rank[a.state as keyof typeof rank] ?? 1) - (rank[b.state as keyof typeof rank] ?? 1)
    return byState !== 0 ? byState : a.sort_key.localeCompare(b.sort_key)
  })
}

export function chosenDestination(
  destinations: readonly TripDestination[],
): TripDestination | null {
  return destinations.find((d) => d.state === 'chosen') ?? null
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}
