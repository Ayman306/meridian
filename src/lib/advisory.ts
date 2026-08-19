/**
 * How old a piece of advisory data is, and whether that matters.
 *
 * Every visa rule, stay allowance and medication restriction in this app
 * carries a `verified_on` date, and until now nothing read it. A rule checked
 * two years ago rendered identically to one checked yesterday — same wording,
 * same source link, same quiet confidence — which is the worst possible shape
 * for data that changes without notice.
 *
 * The threshold is six months, which is a judgement rather than a fact. Visa
 * rules change roughly yearly and announce themselves badly; six months is
 * short enough to catch a change before somebody books on it and long enough
 * that a freshly-checked rule is not nagging about itself.
 *
 * Note what this deliberately does *not* do: nothing here re-checks anything,
 * and a stale rule is still shown. The rule may well still be correct. What
 * changes is that the reader can tell how much weight to put on it, which is
 * the whole point of publishing the date in the first place.
 */
import { monthsUntil, type DateOnly } from '@/lib/dates'

/** Past this, a rule is old enough that the reader should be told so. */
export const STALE_AFTER_MONTHS = 6
/** Past this, it is old enough that "worth re-checking" is an understatement. */
export const VERY_STALE_AFTER_MONTHS = 18

export interface Freshness {
  months: number
  stale: boolean
  veryStale: boolean
}

/**
 * How long ago a rule was checked.
 *
 * Null when there is no date, which is *not* the same as stale: a rule with no
 * `verified_on` was never claimed to be checked at all, and saying "6 months
 * old" about it would be inventing a fact. The surfaces render nothing in that
 * case, exactly as they did before.
 *
 * A date in the future clamps to zero rather than reading as negative months.
 * Somebody's clock being wrong is not a reason to render nonsense.
 */
export function freshness(
  verifiedOn: DateOnly | null | undefined,
  today: DateOnly,
): Freshness | null {
  if (!verifiedOn) return null
  const months = Math.max(0, monthsUntil(today, verifiedOn))
  return {
    months,
    stale: months >= STALE_AFTER_MONTHS,
    veryStale: months >= VERY_STALE_AFTER_MONTHS,
  }
}

/**
 * The sentence to put after "Checked 3 Jan 2026."
 *
 * Empty for a fresh rule: a date with nothing after it already reads as recent,
 * and adding "still current" would be a claim this app cannot make.
 */
export function describeFreshness(age: Freshness | null): string {
  if (!age || !age.stale) return ''
  if (age.veryStale) {
    const years = Math.floor(age.months / 12)
    return years >= 1
      ? `Not checked in over ${years === 1 ? 'a year' : `${years} years`} — treat it as a starting point and open the source.`
      : 'Not checked in a long time — treat it as a starting point and open the source.'
  }
  return `Not checked in ${age.months} months — worth confirming at the source.`
}
