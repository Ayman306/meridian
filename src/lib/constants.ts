/** App-wide constants. Anything a module needs to agree on with another module. */

export const APP_NAME = 'Meridian'

/** Invite codes exclude I, L, O, 0, 1 — they get misread over a video call. */
export const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const INVITE_CODE_LENGTH = 8
export const INVITE_TTL_DAYS = 7

/** Above this many nights, a trip switches to long-stay mode (spec 3.2, 5.2). */
export const LONG_STAY_NIGHTS = 5

/** Soft-deleted rows are hard-deleted by cron after this many days. */
export const SOFT_DELETE_GRACE_DAYS = 30

/** Signed URLs for private storage objects (spec 8.2). */
export const SIGNED_URL_TTL_SECONDS = 300

/** The vault re-auth gate (spec 8.3). */
export const VAULT_IDLE_LOCK_MS = 15 * 60 * 1000

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024

/** Accent colours a profile can pick. Keys are stored, values are CSS hues. */
export const ACCENT_COLORS = {
  amber: '38 92% 50%',
  rose: '347 77% 60%',
  teal: '173 58% 45%',
  violet: '263 70% 62%',
  sky: '199 89% 55%',
  lime: '84 62% 46%',
} as const

export type AccentColor = keyof typeof ACCENT_COLORS
export const DEFAULT_ACCENT: AccentColor = 'amber'

/** Trip statuses seeded per couple (spec 3.1). */
export const SEED_TRIP_STATUSES = [
  'Idea',
  'Planning',
  'Booked',
  'Active',
  'Completed',
  'Cancelled',
] as const

/** Itinerary categories seeded per couple (spec 5.1). */
export const SEED_CATEGORIES = [
  'Food',
  'Sight',
  'Activity',
  'Transport',
  'Stay',
  'Admin',
  'Rest',
] as const

/** Document types seeded per couple (spec 8.1). */
export const SEED_DOCUMENT_TYPES = [
  'Passport',
  'Visa',
  'eTA/ESTA',
  'PR Card',
  'Travel Insurance',
  'Vaccination',
  'Driving Licence',
  'Booking',
  'Other',
] as const

/** Nominatim asks for a real UA and at most 1 req/s. Respect it — it's free. */
export const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org'
export const GEOCODE_MIN_INTERVAL_MS = 1100

export const QUERY_STALE_TIME_MS = 30_000
