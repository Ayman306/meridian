/**
 * Rough daily cost bands. Spec 4.2 lists the attribute; 4.1 says no pricing.
 *
 * Those are reconcilable: a band is not a price. This says "Portugal is
 * cheaper to spend a day in than Switzerland", which is stable, needs no API,
 * and is the only thing a comparison board actually needs. It deliberately
 * does not say what a day costs, because that depends on how you travel and
 * would be wrong the moment it was written.
 *
 * 1 budget · 2 moderate · 3 pricey · 4 expensive. Unlisted means unknown, and
 * unknown is shown as unknown.
 */

export type CostBand = 1 | 2 | 3 | 4

export const COST_LABELS: Record<CostBand, string> = {
  1: 'Budget',
  2: 'Moderate',
  3: 'Pricey',
  4: 'Expensive',
}

const COSTS: Record<string, CostBand> = {
  // Europe
  PT: 2, ES: 2, IT: 3, GR: 2, HR: 2, FR: 3, GB: 3, IE: 3, NL: 3, DE: 3,
  BE: 3, AT: 3, CH: 4, CZ: 2, PL: 2, DK: 4, SE: 3, NO: 4, FI: 3, IS: 4,
  // Middle East and Africa
  AE: 3, TR: 2, MA: 1, EG: 1,
  // Asia
  IN: 1, LK: 1, NP: 1, MV: 4, TH: 1, VN: 1, ID: 1, SG: 3, MY: 1,
  JP: 3, KR: 2, TW: 2,
  // Americas and Oceania
  US: 3, CA: 3, MX: 1, BR: 2, AR: 2, AU: 3, NZ: 3,
}

export function costBand(countryCode: string | null | undefined): CostBand | null {
  if (!countryCode) return null
  return COSTS[countryCode.toUpperCase()] ?? null
}
