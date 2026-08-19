/**
 * Where they sleep, as arithmetic.
 *
 * ## The one rule everything here depends on
 *
 * **`check_out` is exclusive.** A stay covers nights, not days: three nights
 * from the 4th is `check_in` 04, `check_out` 07. The 7th is a day you are there
 * for the morning of and not the night of.
 *
 * Every function below uses `check_in <= date < check_out` for "which stay
 * covers this", and `date === check_out` for "this is the morning we leave".
 * Getting it backwards shows somebody a hotel on a night they had already
 * checked out of, which is exactly the kind of wrong that looks right until
 * you are standing outside it.
 *
 * Pure, and unit-tested. The journey view and the stays screen both read from
 * here, so an off-by-one lands in two places at once.
 */
import { addDaysTo, daysBetween, type DateOnly } from '@/lib/dates'
import type { Accommodation, StayGap, StayOverlap } from './types'

/** Nights, not days. Null when either end is unknown. */
export function nightsAt(stay: Pick<Accommodation, 'check_in' | 'check_out'>): number | null {
  if (!stay.check_in || !stay.check_out) return null
  return Math.max(0, daysBetween(stay.check_in, stay.check_out))
}

/** Ordered the way a trip runs. Stays without a check-in date sort last. */
export function sortStays<T extends Pick<Accommodation, 'check_in'>>(stays: readonly T[]): T[] {
  return [...stays].sort((a, b) => {
    if (!a.check_in && !b.check_in) return 0
    if (!a.check_in) return 1
    if (!b.check_in) return -1
    return a.check_in.localeCompare(b.check_in)
  })
}

/**
 * Which stay covers a given night.
 *
 * The check-out morning belongs to the *next* stay, or to nothing. Somebody
 * moving hotels on the 7th is at the new one that night, and the old booking
 * has nothing to say about it.
 */
export function stayOn<T extends Pick<Accommodation, 'check_in' | 'check_out'>>(
  date: DateOnly,
  stays: readonly T[],
): T | null {
  return (
    stays.find(
      (s) => s.check_in !== null && date >= s.check_in && (s.check_out === null || date < s.check_out),
    ) ?? null
  )
}

/** True on the morning somebody has to be out — worth saying before they oversleep. */
export function isCheckoutDay<T extends Pick<Accommodation, 'check_out'>>(
  date: DateOnly,
  stays: readonly T[],
): boolean {
  return stays.some((s) => s.check_out === date)
}

/**
 * Nights of the trip with nowhere booked.
 *
 * A trip from the 1st to the 5th has four nights: the 1st through the 4th. The
 * departure day is not a night, which is why the loop stops one short of
 * `end` — counting it would report a phantom gap on every trip that has one.
 *
 * Returned as runs rather than as loose dates because "the 3rd and the 4th are
 * unbooked" is one problem to solve, not two.
 */
export function uncoveredNights(
  start: DateOnly | null,
  end: DateOnly | null,
  stays: readonly Pick<Accommodation, 'check_in' | 'check_out'>[],
): StayGap[] {
  if (!start || !end) return []
  const nights = daysBetween(start, end)
  if (nights <= 0) return []

  const gaps: StayGap[] = []
  let run: DateOnly | null = null

  for (let i = 0; i < nights; i++) {
    const night = addDaysTo(start, i)
    const covered = stayOn(night, stays) !== null

    if (!covered && run === null) run = night
    if (covered && run !== null) {
      gaps.push({ from: run, to: night, nights: daysBetween(run, night) })
      run = null
    }
  }
  if (run !== null) {
    gaps.push({ from: run, to: end, nights: daysBetween(run, end) })
  }

  return gaps
}

/**
 * Two bookings claiming the same night.
 *
 * Nearly always a mistake — a duplicate entry, or a change of plan where the
 * old booking was never removed. Surfaced rather than resolved: the app has no
 * business guessing which one is real, and paying for two rooms on purpose is
 * a thing people occasionally do.
 */
export function overlappingStays(stays: readonly Accommodation[]): StayOverlap[] {
  const dated = sortStays(stays.filter((s) => s.check_in && s.check_out))
  const found: StayOverlap[] = []

  for (let i = 0; i < dated.length; i++) {
    for (let j = i + 1; j < dated.length; j++) {
      const a = dated[i]!
      const b = dated[j]!
      const from = a.check_in! > b.check_in! ? a.check_in! : b.check_in!
      const to = a.check_out! < b.check_out! ? a.check_out! : b.check_out!
      const nights = daysBetween(from, to)
      if (nights > 0) found.push({ a, b, from, nights })
    }
  }

  return found
}

export const KIND_LABELS: Record<string, string> = {
  hotel: 'Hotel',
  apartment: 'Apartment',
  guesthouse: 'Guesthouse',
  family: 'Family',
  other: 'Stay',
}

/** A line for a card. Says what is known and does not pad out what is not. */
export function describeStay(stay: Accommodation): string {
  const parts = [KIND_LABELS[stay.kind] ?? 'Stay']
  const n = nightsAt(stay)
  if (n !== null) parts.push(n === 1 ? '1 night' : `${n} nights`)
  else if (stay.check_in) parts.push(`from ${stay.check_in}`)
  if (stay.city) parts.push(stay.city)
  return parts.join(' · ')
}
