/**
 * Module 12 — Health. Pure, no React and no Supabase.
 *
 * The rules in spec 12.6 are called non-negotiable and they shape this file
 * more than the arithmetic does:
 *
 * - **A prediction is always an estimate.** There is no code path that returns
 *   a date without a variance beside it, and no branch where `isEstimate` is
 *   false. `Prediction` is a union whose "no" case carries a reason, so a
 *   caller cannot accidentally render a confident date from thin data.
 * - **An irregular cycle is a range, not a date.** Above a standard deviation
 *   of seven days the app says so and shows the window.
 * - **No medical advice.** Nothing here computes fertility, ovulation or
 *   contraception, and nothing decides whether a medication may be carried.
 *   The restriction helpers match a name and hand back the official link.
 * - **"Not checked" is never "safe."** A substance with no restriction row
 *   returns `null`, and the copy for that state says the check was not done.
 */
import { addDaysTo, daysBetween, type DateOnly } from '@/lib/dates'
import type {
  CycleLog,
  HealthRecord,
  MedicationRestriction,
  Prediction,
  SupplyCheck,
} from './types'

/** How many cycles the average is taken over. Spec 12.3. */
const WINDOW = 6
/** Below this, no prediction at all. */
const MINIMUM = 3

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

/** Population standard deviation — the spread of what was actually logged. */
function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0
  const average = mean(values)
  return Math.sqrt(mean(values.map((v) => (v - average) ** 2)))
}

/**
 * When the next cycle might start.
 *
 * Gaps are measured start-to-start over at most the last six logs, which is
 * what a cycle length is. Two logs give one gap and no notion of spread, so
 * three is the floor — and below it the refusal explains itself rather than
 * rendering an empty card.
 */
export function predict(logs: CycleLog[]): Prediction {
  const ordered = [...logs].sort((a, b) => a.started_on.localeCompare(b.started_on))
  const recent = ordered.slice(-WINDOW)

  if (recent.length < MINIMUM) {
    return {
      available: false,
      basedOn: recent.length,
      reason:
        recent.length === 0
          ? 'Nothing logged yet.'
          : `Two more cycles and there is enough to estimate from. ${recent.length} logged so far.`,
    }
  }

  const gaps = recent.slice(1).map((log, i) => daysBetween(recent[i]!.started_on, log.started_on))
  const average = Math.round(mean(gaps))
  const spread = Math.round(standardDeviation(gaps))
  const last = recent[recent.length - 1]!

  const confidence = spread < 3 ? 'regular' : spread < 7 ? 'variable' : 'irregular'
  const nextStart = addDaysTo(last.started_on, average)

  return {
    available: true,
    nextStart,
    variance: spread,
    // The window is what an irregular cycle is shown as, and it is computed
    // for every confidence level so the caller never has to derive it.
    earliest: addDaysTo(nextStart, -spread),
    latest: addDaysTo(nextStart, spread),
    confidence,
    averageLength: average,
    basedOn: recent.length,
    isEstimate: true,
  }
}

/**
 * The sentence a prediction is rendered as.
 *
 * One function so the estimate label and the variance cannot be dropped by a
 * component that only wanted the date. An irregular cycle gets a range, never
 * a day (spec 12.7).
 */
export function describePrediction(prediction: Prediction): string {
  if (!prediction.available) return prediction.reason

  if (prediction.confidence === 'irregular') {
    return `Somewhere between ${prediction.earliest} and ${prediction.latest}, based on ${prediction.basedOn} cycles. These have varied by about ${prediction.variance} days, so this is a wide estimate.`
  }
  return `Around ${prediction.nextStart}, give or take ${prediction.variance} ${
    prediction.variance === 1 ? 'day' : 'days'
  } — an estimate from the last ${prediction.basedOn} cycles.`
}

/** Length of each logged period, for the history list. */
export function periodLength(log: CycleLog): number | null {
  if (!log.ended_on) return null
  return daysBetween(log.started_on, log.ended_on) + 1
}

/** Gaps between consecutive starts, oldest first. */
export function cycleLengths(logs: CycleLog[]): number[] {
  const ordered = [...logs].sort((a, b) => a.started_on.localeCompare(b.started_on))
  return ordered.slice(1).map((log, i) => daysBetween(ordered[i]!.started_on, log.started_on))
}

// ---------------------------------------------------------------------------
// Medication supply
// ---------------------------------------------------------------------------

/**
 * Whether a medication lasts the trip. Spec 12.3.
 *
 * `computable: false` when the record carries no numbers — a person may well
 * write "one in the morning" in the dosage field and never fill in the count,
 * and inventing a figure from that would be worse than saying nothing.
 */
export function checkSupply(record: HealthRecord, tripNights: number): SupplyCheck {
  const perDay = Number(record.doses_per_day ?? 0)
  const remaining = Number(record.quantity_remaining ?? 0)

  if (!record.doses_per_day || !record.quantity_remaining || perDay <= 0) {
    return { daysOfSupply: 0, tripNights, shortfall: 0, computable: false }
  }

  const daysOfSupply = Math.floor(remaining / perDay)
  return {
    daysOfSupply,
    tripNights,
    shortfall: Math.max(0, tripNights - daysOfSupply),
    computable: true,
  }
}

export function describeSupply(check: SupplyCheck, label: string): string | null {
  if (!check.computable) return null
  if (check.shortfall <= 0) {
    return `${label}: ${check.daysOfSupply} days' worth, enough for the ${check.tripNights} nights.`
  }
  return `${label}: you would run short by ${check.shortfall} ${
    check.shortfall === 1 ? 'day' : 'days'
  }.`
}

// ---------------------------------------------------------------------------
// Border restrictions
// ---------------------------------------------------------------------------

/**
 * Restrictions that might apply to what somebody is carrying.
 *
 * Substring matching in both directions, because a record says "Sudafed" or
 * "Codeine 30mg" and the table says "pseudoephedrine" or "codeine". The match
 * is deliberately loose: this only ever produces a prompt to go and read the
 * official page, so a false positive costs a click and a false negative costs
 * somebody their medication at a border.
 */
export function matchRestrictions(
  records: HealthRecord[],
  restrictions: MedicationRestriction[],
): { record: HealthRecord; restriction: MedicationRestriction }[] {
  const medications = records.filter((r) => r.kind === 'medication')
  const out: { record: HealthRecord; restriction: MedicationRestriction }[] = []

  for (const record of medications) {
    const haystack = `${record.label} ${record.dosage ?? ''}`.toLowerCase()
    for (const restriction of restrictions) {
      const needle = restriction.substance.toLowerCase()
      if (haystack.includes(needle) || needle.includes(record.label.toLowerCase().trim())) {
        out.push({ record, restriction })
      }
    }
  }
  return out
}

/**
 * The only thing the app says about restrictions, verbatim from spec 12.2.
 *
 * It names the country, says to check, and links. It never says whether
 * anything is allowed, because that is a regulated claim and the app is not
 * the authority.
 */
export function restrictionNotice(country: string): string {
  return `Some medications are restricted in ${country}. Check the official guidance before travelling.`
}

/** No data is "not checked", never "safe" (spec 12.7). */
export const NOT_CHECKED =
  'No restriction data for this country. That means it has not been checked, not that there is nothing to check.'

export const HEALTH_DISCLAIMER =
  'This is a record of what you have chosen to write down. It is not medical advice, and nothing here is a diagnosis or a recommendation.'

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

import type { ConsentScope, HealthConsent } from './types'

export const SCOPES: ConsentScope[] = [
  'cycle',
  'cycle_predictions',
  'symptoms',
  'medications',
  'vaccinations',
  'notes',
]

export const SCOPE_LABELS: Record<ConsentScope, string> = {
  cycle: 'Cycle dates',
  cycle_predictions: 'Cycle predictions',
  symptoms: 'Symptoms',
  medications: 'Medications',
  vaccinations: 'Vaccinations',
  notes: 'Conditions and allergies',
}

export const SCOPE_DESCRIPTIONS: Record<ConsentScope, string> = {
  cycle: 'When each one started and ended.',
  cycle_predictions: 'The estimate of when the next one might start.',
  symptoms: 'Anything logged alongside a cycle.',
  medications: 'What you take, and how much.',
  vaccinations: 'What you have had, and when it runs out.',
  notes: 'Conditions and allergies.',
}

/**
 * The client-side consent check. Spec 12.3 calls this belt and braces, and it
 * is exactly that: RLS is the real gate, and this only decides whether a
 * component bothers to ask.
 */
export function hasConsent(
  consents: HealthConsent[],
  ownerId: string,
  viewerId: string,
  scope: ConsentScope,
): boolean {
  return consents.some(
    (c) =>
      c.owner_id === ownerId &&
      c.viewer_id === viewerId &&
      c.scope === scope &&
      c.revoked_at === null,
  )
}

/** Scopes currently granted to one viewer, for the "exactly what is shared" list. */
export function grantedScopes(consents: HealthConsent[], viewerId: string): ConsentScope[] {
  return SCOPES.filter((scope) =>
    consents.some((c) => c.viewer_id === viewerId && c.scope === scope && c.revoked_at === null),
  )
}

export function describeSharing(scopes: ConsentScope[]): string {
  if (scopes.length === 0) return 'Nothing is shared.'
  if (scopes.length === SCOPES.length) return 'Everything is shared.'
  return `Shared: ${scopes.map((s) => SCOPE_LABELS[s]).join(', ')}.`
}

/** Days a cycle log covers, for the calendar. */
export function cycleDays(log: CycleLog): DateOnly[] {
  const end = log.ended_on ?? log.started_on
  const span = daysBetween(log.started_on, end)
  return Array.from({ length: span + 1 }, (_, i) => addDaysTo(log.started_on, i))
}
