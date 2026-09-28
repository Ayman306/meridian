/**
 * The migration this build of the app was written against.
 *
 * `/api/health` compares it with `public.schema_version()` on the live
 * database and reports drift when they differ — the check that would have
 * caught D139, where two merged migrations never reached production.
 *
 * Bump it in the same change as every new migration, which must redefine
 * `schema_version()` to the same number. `schemaVersion.test.ts` holds both
 * to the newest file in `supabase/migrations`.
 */
export const SCHEMA_VERSION = 39
