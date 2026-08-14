/**
 * ISO 4217 currencies, and which one a country actually uses.
 *
 * Two things live here that the rest of the app should not have to know.
 *
 * **Minor units are not always two.** Yen and won have none; dinars have
 * three. The expense column is `numeric(12,2)`, so two is what gets *stored*,
 * but splitting ¥1,001 into ¥500.50 each is not money anyone can hand over.
 * `minorUnitsOf` is what `logic.ts` rounds to, so an odd yen goes to the payer
 * whole, exactly as an odd cent does.
 *
 * **A country implies a currency**, and that is how the destination-currency
 * conversion works: a trip's chosen destination carries a `country_code`, not
 * a currency, because the destinations module is about places.
 *
 * The list is the currencies a traveller plausibly meets, not all 180 of them.
 * An unlisted code still works everywhere — it formats, converts and stores;
 * it just is not in the picker's suggestions.
 */

export interface Currency {
  code: string
  name: string
  symbol: string
  /** Decimal places the currency actually has. Almost always 2. */
  minorUnits: number
}

export const CURRENCIES: Currency[] = [
  { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ', minorUnits: 2 },
  { code: 'ARS', name: 'Argentine Peso', symbol: '$', minorUnits: 2 },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', minorUnits: 2 },
  { code: 'BGN', name: 'Bulgarian Lev', symbol: 'лв', minorUnits: 2 },
  { code: 'BHD', name: 'Bahraini Dinar', symbol: '.د.ب', minorUnits: 3 },
  { code: 'BRL', name: 'Brazilian Real', symbol: 'R$', minorUnits: 2 },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$', minorUnits: 2 },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF', minorUnits: 2 },
  { code: 'CLP', name: 'Chilean Peso', symbol: '$', minorUnits: 0 },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥', minorUnits: 2 },
  { code: 'COP', name: 'Colombian Peso', symbol: '$', minorUnits: 2 },
  { code: 'CZK', name: 'Czech Koruna', symbol: 'Kč', minorUnits: 2 },
  { code: 'DKK', name: 'Danish Krone', symbol: 'kr', minorUnits: 2 },
  { code: 'EGP', name: 'Egyptian Pound', symbol: 'E£', minorUnits: 2 },
  { code: 'EUR', name: 'Euro', symbol: '€', minorUnits: 2 },
  { code: 'GBP', name: 'Pound Sterling', symbol: '£', minorUnits: 2 },
  { code: 'HKD', name: 'Hong Kong Dollar', symbol: 'HK$', minorUnits: 2 },
  { code: 'HUF', name: 'Hungarian Forint', symbol: 'Ft', minorUnits: 2 },
  { code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp', minorUnits: 2 },
  { code: 'ILS', name: 'Israeli New Shekel', symbol: '₪', minorUnits: 2 },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹', minorUnits: 2 },
  { code: 'ISK', name: 'Icelandic Króna', symbol: 'kr', minorUnits: 0 },
  { code: 'JOD', name: 'Jordanian Dinar', symbol: 'د.ا', minorUnits: 3 },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥', minorUnits: 0 },
  { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh', minorUnits: 2 },
  { code: 'KRW', name: 'South Korean Won', symbol: '₩', minorUnits: 0 },
  { code: 'KWD', name: 'Kuwaiti Dinar', symbol: 'د.ك', minorUnits: 3 },
  { code: 'LKR', name: 'Sri Lankan Rupee', symbol: 'Rs', minorUnits: 2 },
  { code: 'MAD', name: 'Moroccan Dirham', symbol: 'د.م.', minorUnits: 2 },
  { code: 'MXN', name: 'Mexican Peso', symbol: '$', minorUnits: 2 },
  { code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM', minorUnits: 2 },
  { code: 'NOK', name: 'Norwegian Krone', symbol: 'kr', minorUnits: 2 },
  { code: 'NPR', name: 'Nepalese Rupee', symbol: 'Rs', minorUnits: 2 },
  { code: 'NZD', name: 'New Zealand Dollar', symbol: 'NZ$', minorUnits: 2 },
  { code: 'PEN', name: 'Peruvian Sol', symbol: 'S/', minorUnits: 2 },
  { code: 'PHP', name: 'Philippine Peso', symbol: '₱', minorUnits: 2 },
  { code: 'PKR', name: 'Pakistani Rupee', symbol: 'Rs', minorUnits: 2 },
  { code: 'PLN', name: 'Polish Złoty', symbol: 'zł', minorUnits: 2 },
  { code: 'QAR', name: 'Qatari Riyal', symbol: 'ر.ق', minorUnits: 2 },
  { code: 'RON', name: 'Romanian Leu', symbol: 'lei', minorUnits: 2 },
  { code: 'RSD', name: 'Serbian Dinar', symbol: 'дин', minorUnits: 2 },
  { code: 'SAR', name: 'Saudi Riyal', symbol: 'ر.س', minorUnits: 2 },
  { code: 'SEK', name: 'Swedish Krona', symbol: 'kr', minorUnits: 2 },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$', minorUnits: 2 },
  { code: 'THB', name: 'Thai Baht', symbol: '฿', minorUnits: 2 },
  { code: 'TRY', name: 'Turkish Lira', symbol: '₺', minorUnits: 2 },
  { code: 'TWD', name: 'New Taiwan Dollar', symbol: 'NT$', minorUnits: 2 },
  { code: 'TZS', name: 'Tanzanian Shilling', symbol: 'TSh', minorUnits: 2 },
  { code: 'UAH', name: 'Ukrainian Hryvnia', symbol: '₴', minorUnits: 2 },
  { code: 'USD', name: 'US Dollar', symbol: '$', minorUnits: 2 },
  { code: 'VND', name: 'Vietnamese Đồng', symbol: '₫', minorUnits: 0 },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R', minorUnits: 2 },
]

const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]))

export function currencyInfo(code: string): Currency | null {
  return BY_CODE.get(code.toUpperCase()) ?? null
}

/**
 * Decimal places to round to. Two for anything unlisted, which is right for
 * the overwhelming majority and is what the column stores anyway.
 */
export function minorUnitsOf(code: string): number {
  return BY_CODE.get(code.toUpperCase())?.minorUnits ?? 2
}

export function currencySymbol(code: string): string {
  return BY_CODE.get(code.toUpperCase())?.symbol ?? code.toUpperCase()
}

/**
 * ISO 3166-1 alpha-2 → the currency you actually pay with there.
 *
 * Only the countries the app can produce: everything in the visa and allowance
 * seeds, the Schengen area, and the common destinations. A country not listed
 * yields null, and the destination conversion simply does not appear — a wrong
 * currency would be worse than no currency.
 */
const COUNTRY_CURRENCY: Record<string, string> = {
  // Eurozone
  AT: 'EUR', BE: 'EUR', HR: 'EUR', CY: 'EUR', EE: 'EUR', FI: 'EUR', FR: 'EUR',
  DE: 'EUR', GR: 'EUR', IE: 'EUR', IT: 'EUR', LV: 'EUR', LT: 'EUR', LU: 'EUR',
  MT: 'EUR', NL: 'EUR', PT: 'EUR', SK: 'EUR', SI: 'EUR', ES: 'EUR',
  // Rest of Europe
  AL: 'EUR', BG: 'BGN', CZ: 'CZK', DK: 'DKK', HU: 'HUF', IS: 'ISK', LI: 'CHF',
  NO: 'NOK', PL: 'PLN', RO: 'RON', RS: 'RSD', SE: 'SEK', CH: 'CHF', UA: 'UAH',
  GB: 'GBP', TR: 'TRY',
  // Americas
  AR: 'ARS', BR: 'BRL', CA: 'CAD', CL: 'CLP', CO: 'COP', MX: 'MXN', PE: 'PEN',
  US: 'USD',
  // Asia
  CN: 'CNY', HK: 'HKD', ID: 'IDR', IN: 'INR', JP: 'JPY', KR: 'KRW', LK: 'LKR',
  MY: 'MYR', NP: 'NPR', PH: 'PHP', PK: 'PKR', SG: 'SGD', TH: 'THB', TW: 'TWD',
  VN: 'VND',
  // Middle East and Africa
  AE: 'AED', BH: 'BHD', EG: 'EGP', IL: 'ILS', JO: 'JOD', KE: 'KES', KW: 'KWD',
  MA: 'MAD', QA: 'QAR', SA: 'SAR', TZ: 'TZS', ZA: 'ZAR',
  // Oceania
  AU: 'AUD', NZ: 'NZD',
}

export function currencyForCountry(countryCode: string | null | undefined): string | null {
  if (!countryCode) return null
  return COUNTRY_CURRENCY[countryCode.toUpperCase()] ?? null
}

/**
 * Search the picker runs. Matches a code, a name or a symbol, and puts exact
 * code matches first so typing "INR" does not rank "Indian Rupee" below
 * something that merely contains the letters.
 */
export function searchCurrencies(query: string): Currency[] {
  const q = query.trim().toLowerCase()
  if (!q) return CURRENCIES
  const matches = CURRENCIES.filter(
    (c) =>
      c.code.toLowerCase().includes(q) ||
      c.name.toLowerCase().includes(q) ||
      c.symbol.toLowerCase().includes(q),
  )
  return matches.sort((a, b) => {
    const aExact = a.code.toLowerCase() === q ? 0 : 1
    const bExact = b.code.toLowerCase() === q ? 0 : 1
    return aExact - bExact || a.code.localeCompare(b.code)
  })
}
