/**
 * Season bands by country and month. Spec 4.3.
 *
 * A static table rather than a weather API, and the spec is right about why:
 * it is free, it never rate-limits, it never goes stale, and it works offline.
 * "Is Lisbon pleasant in May?" has had the same answer for a century.
 *
 * Bands are coarse on purpose — a country is not one climate, and pretending
 * otherwise with a decimal temperature would be false precision. Coverage is
 * deliberately partial: an unlisted country shows nothing rather than a guess.
 *
 * Derived from Köppen classifications for each country's most-visited region.
 */

export type Band = 'cold' | 'mild' | 'warm' | 'hot' | 'rainy' | 'storm'

export const BAND_LABELS: Record<Band, string> = {
  cold: 'Cold',
  mild: 'Mild',
  warm: 'Warm',
  hot: 'Hot',
  rainy: 'Rainy',
  storm: 'Storm season',
}

/** Twelve bands, January first. */
type Year = [Band, Band, Band, Band, Band, Band, Band, Band, Band, Band, Band, Band]

const CLIMATE: Record<string, Year> = {
  // Southern Europe
  PT: ['mild', 'mild', 'mild', 'mild', 'warm', 'warm', 'hot', 'hot', 'warm', 'mild', 'rainy', 'rainy'],
  ES: ['cold', 'cold', 'mild', 'mild', 'warm', 'hot', 'hot', 'hot', 'warm', 'mild', 'mild', 'cold'],
  IT: ['cold', 'cold', 'mild', 'mild', 'warm', 'hot', 'hot', 'hot', 'warm', 'mild', 'rainy', 'cold'],
  GR: ['cold', 'cold', 'mild', 'mild', 'warm', 'hot', 'hot', 'hot', 'warm', 'mild', 'rainy', 'cold'],
  HR: ['cold', 'cold', 'mild', 'mild', 'warm', 'warm', 'hot', 'hot', 'warm', 'mild', 'rainy', 'cold'],

  // Western and northern Europe
  FR: ['cold', 'cold', 'mild', 'mild', 'mild', 'warm', 'warm', 'warm', 'mild', 'mild', 'rainy', 'cold'],
  GB: ['cold', 'cold', 'cold', 'mild', 'mild', 'mild', 'warm', 'warm', 'mild', 'rainy', 'rainy', 'cold'],
  IE: ['cold', 'cold', 'cold', 'mild', 'mild', 'mild', 'mild', 'mild', 'mild', 'rainy', 'rainy', 'cold'],
  NL: ['cold', 'cold', 'cold', 'mild', 'mild', 'mild', 'warm', 'warm', 'mild', 'rainy', 'cold', 'cold'],
  DE: ['cold', 'cold', 'cold', 'mild', 'mild', 'warm', 'warm', 'warm', 'mild', 'mild', 'cold', 'cold'],
  BE: ['cold', 'cold', 'cold', 'mild', 'mild', 'mild', 'warm', 'warm', 'mild', 'rainy', 'cold', 'cold'],
  AT: ['cold', 'cold', 'cold', 'mild', 'mild', 'warm', 'warm', 'warm', 'mild', 'mild', 'cold', 'cold'],
  CH: ['cold', 'cold', 'cold', 'mild', 'mild', 'warm', 'warm', 'warm', 'mild', 'mild', 'cold', 'cold'],
  CZ: ['cold', 'cold', 'cold', 'mild', 'mild', 'warm', 'warm', 'warm', 'mild', 'mild', 'cold', 'cold'],
  PL: ['cold', 'cold', 'cold', 'mild', 'mild', 'warm', 'warm', 'warm', 'mild', 'cold', 'cold', 'cold'],
  DK: ['cold', 'cold', 'cold', 'cold', 'mild', 'mild', 'warm', 'warm', 'mild', 'cold', 'cold', 'cold'],
  SE: ['cold', 'cold', 'cold', 'cold', 'mild', 'mild', 'warm', 'warm', 'mild', 'cold', 'cold', 'cold'],
  NO: ['cold', 'cold', 'cold', 'cold', 'mild', 'mild', 'mild', 'mild', 'mild', 'cold', 'cold', 'cold'],
  FI: ['cold', 'cold', 'cold', 'cold', 'mild', 'mild', 'warm', 'warm', 'mild', 'cold', 'cold', 'cold'],
  IS: ['cold', 'cold', 'cold', 'cold', 'cold', 'mild', 'mild', 'mild', 'cold', 'cold', 'cold', 'cold'],

  // Middle East and north Africa
  AE: ['mild', 'warm', 'warm', 'hot', 'hot', 'hot', 'hot', 'hot', 'hot', 'hot', 'warm', 'mild'],
  TR: ['cold', 'cold', 'mild', 'mild', 'warm', 'hot', 'hot', 'hot', 'warm', 'mild', 'rainy', 'cold'],
  MA: ['mild', 'mild', 'mild', 'warm', 'warm', 'hot', 'hot', 'hot', 'warm', 'warm', 'mild', 'mild'],
  EG: ['mild', 'mild', 'warm', 'warm', 'hot', 'hot', 'hot', 'hot', 'hot', 'warm', 'mild', 'mild'],

  // South and southeast Asia
  IN: ['mild', 'warm', 'hot', 'hot', 'hot', 'rainy', 'rainy', 'rainy', 'rainy', 'warm', 'mild', 'mild'],
  LK: ['warm', 'warm', 'hot', 'rainy', 'rainy', 'warm', 'warm', 'warm', 'warm', 'rainy', 'rainy', 'warm'],
  NP: ['cold', 'cold', 'mild', 'warm', 'warm', 'rainy', 'rainy', 'rainy', 'rainy', 'mild', 'mild', 'cold'],
  MV: ['warm', 'warm', 'hot', 'hot', 'rainy', 'rainy', 'rainy', 'rainy', 'rainy', 'rainy', 'warm', 'warm'],
  TH: ['warm', 'hot', 'hot', 'hot', 'rainy', 'rainy', 'rainy', 'rainy', 'rainy', 'rainy', 'warm', 'warm'],
  VN: ['mild', 'mild', 'warm', 'hot', 'hot', 'rainy', 'rainy', 'rainy', 'storm', 'storm', 'mild', 'mild'],
  ID: ['rainy', 'rainy', 'rainy', 'warm', 'warm', 'warm', 'warm', 'warm', 'warm', 'rainy', 'rainy', 'rainy'],
  SG: ['rainy', 'warm', 'warm', 'warm', 'hot', 'hot', 'hot', 'hot', 'warm', 'warm', 'rainy', 'rainy'],
  MY: ['warm', 'warm', 'warm', 'warm', 'hot', 'hot', 'hot', 'hot', 'warm', 'rainy', 'rainy', 'rainy'],

  // East Asia
  JP: ['cold', 'cold', 'mild', 'mild', 'warm', 'rainy', 'hot', 'hot', 'storm', 'mild', 'mild', 'cold'],
  KR: ['cold', 'cold', 'mild', 'mild', 'warm', 'warm', 'rainy', 'hot', 'warm', 'mild', 'cold', 'cold'],
  TW: ['mild', 'mild', 'warm', 'warm', 'hot', 'hot', 'storm', 'storm', 'storm', 'warm', 'mild', 'mild'],

  // Americas and Oceania
  US: ['cold', 'cold', 'mild', 'mild', 'warm', 'hot', 'hot', 'hot', 'warm', 'mild', 'cold', 'cold'],
  CA: ['cold', 'cold', 'cold', 'cold', 'mild', 'warm', 'warm', 'warm', 'mild', 'cold', 'cold', 'cold'],
  MX: ['mild', 'warm', 'warm', 'hot', 'hot', 'rainy', 'rainy', 'rainy', 'storm', 'warm', 'mild', 'mild'],
  BR: ['hot', 'hot', 'warm', 'warm', 'mild', 'mild', 'mild', 'mild', 'warm', 'warm', 'hot', 'hot'],
  AR: ['hot', 'hot', 'warm', 'mild', 'cold', 'cold', 'cold', 'cold', 'mild', 'warm', 'warm', 'hot'],
  AU: ['hot', 'hot', 'warm', 'mild', 'mild', 'cold', 'cold', 'cold', 'mild', 'warm', 'warm', 'hot'],
  NZ: ['warm', 'warm', 'mild', 'mild', 'cold', 'cold', 'cold', 'cold', 'mild', 'mild', 'warm', 'warm'],
}

/**
 * The band for a country in a month (1–12), or null when we have no entry.
 *
 * Null is a real answer here. "We don't know" beats a made-up temperate guess
 * for a country nobody put in the table.
 */
export function seasonBand(countryCode: string | null, month: number | null): Band | null {
  if (!countryCode || !month || month < 1 || month > 12) return null
  return CLIMATE[countryCode.toUpperCase()]?.[month - 1] ?? null
}

/** How pleasant a band is to travel in, 0–1. Only used when scoring is on. */
export const BAND_SCORE: Record<Band, number> = {
  mild: 1,
  warm: 0.85,
  cold: 0.5,
  hot: 0.4,
  rainy: 0.3,
  storm: 0,
}
