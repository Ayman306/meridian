import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SCHEMA_VERSION } from './schemaVersion'

/**
 * `/api/health` reports drift by comparing `public.schema_version()` with
 * `SCHEMA_VERSION` (D140). Both are hand-maintained, so both are held to the
 * one thing that cannot be forgotten: the newest migration file.
 */
describe('schema version', () => {
  const dir = join(process.cwd(), 'supabase/migrations')
  const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort()
  const newest = files[files.length - 1]!
  const number = Number(newest.slice(0, 4))

  it('the newest migration redefines schema_version() to its own number', () => {
    const sql = readFileSync(join(dir, newest), 'utf8')
    const match = sql.match(/function\s+public\.schema_version\(\)[\s\S]*?select\s+(\d+)\s*;/i)
    expect(
      match,
      `${newest} must end by redefining public.schema_version() to return ${number} — see 0039`,
    ).not.toBeNull()
    expect(Number(match![1])).toBe(number)
  })

  it('the app is built for the newest migration', () => {
    expect(SCHEMA_VERSION, 'bump src/lib/schemaVersion.ts with the migration').toBe(number)
  })
})
