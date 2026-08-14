/**
 * Travel zones that count as one country for immigration purposes.
 *
 * Shared by Destinations (which looks up a visa rule for the zone when there
 * is none for the country) and Stay Allowance (which counts days across every
 * member together). It lives in `lib` because both need it and neither owns
 * it — and because getting Schengen membership wrong in two places
 * independently is a way to get it wrong in one of them.
 *
 * The database carries the same list in `allowance_rules.region_members`; that
 * copy is what the seeded rules count against, and this one is what the client
 * uses to decide which rule applies before it has fetched anything.
 */

/** The 29 Schengen states as of 2026. Not the same set as the EU. */
export const SCHENGEN_MEMBERS = [
  'AT', 'BE', 'BG', 'HR', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE',
  'GR', 'HU', 'IS', 'IT', 'LV', 'LI', 'LT', 'LU', 'MT', 'NL',
  'NO', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'CH',
] as const

export const ZONES: Record<string, readonly string[]> = {
  SCHENGEN: SCHENGEN_MEMBERS,
}

export const ZONE_LABELS: Record<string, string> = {
  SCHENGEN: 'Schengen area',
}

/** The zone a country belongs to, or null if it stands alone. */
export function zoneFor(countryCode: string | null | undefined): string | null {
  if (!countryCode) return null
  const code = countryCode.toUpperCase()
  for (const [zone, members] of Object.entries(ZONES)) {
    if (members.includes(code)) return zone
  }
  return null
}

/**
 * Every country a rule covers.
 *
 * A zone rule covers its members; a country rule covers itself. Used to decide
 * which log entries count against which limit — a week in Portugal and a week
 * in Spain are two weeks of the same Schengen allowance.
 */
export function countriesCovered(
  destinationCountry: string,
  regionMembers: readonly string[] | null,
): string[] {
  if (regionMembers && regionMembers.length > 0) return regionMembers.map((c) => c.toUpperCase())
  const code = destinationCountry.toUpperCase()
  return ZONES[code] ? [...ZONES[code]!] : [code]
}

/** How to name a destination in prose: the zone if it is one, else the country. */
export function displayCountry(code: string | null | undefined): string {
  if (!code) return 'Unknown'
  return ZONE_LABELS[code.toUpperCase()] ?? code.toUpperCase()
}
