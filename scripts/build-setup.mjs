/**
 * Concatenates the migrations into one file that can be pasted into the
 * Supabase SQL editor in a single go.
 *
 * The bundle is committed and CI checks it is in sync, so it can never drift
 * from the migrations it is built from.
 *
 *   node scripts/build-setup.mjs          # write it
 *   node scripts/build-setup.mjs --check  # fail if out of date
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const migrationsDir = join(root, 'supabase', 'migrations')
const outPath = join(root, 'supabase', 'setup.sql')

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()

const header = `-- =============================================================================
-- Meridian — complete setup.
--
-- GENERATED FILE. Do not edit: change the migrations and run
--   node scripts/build-setup.mjs
--
-- Paste the whole thing into the Supabase SQL editor and run it once, on a
-- fresh project. It is the concatenation of:
${files.map((f) => `--   supabase/migrations/${f}`).join('\n')}
--
-- Safe to re-run: every statement is idempotent or uses "or replace".
-- =============================================================================

`

const body = files
  .map((f) => {
    const banner = `\n\n-- ${'='.repeat(75)}\n-- ${f}\n-- ${'='.repeat(75)}\n\n`
    return banner + readFileSync(join(migrationsDir, f), 'utf8').trim() + '\n'
  })
  .join('')

const bundle = header + body.trimStart() + '\n'

if (process.argv.includes('--check')) {
  const current = readFileSync(outPath, 'utf8')
  if (current !== bundle) {
    console.error('supabase/setup.sql is out of date. Run: node scripts/build-setup.mjs')
    process.exit(1)
  }
  console.log('supabase/setup.sql is in sync with the migrations.')
} else {
  writeFileSync(outPath, bundle)
  console.log(`Wrote supabase/setup.sql from ${files.length} migrations.`)
}
