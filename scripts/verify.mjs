#!/usr/bin/env node
/**
 * Everything CI used to run, on this machine.
 *
 * GitHub Actions bills minutes on private repositories, and when the allowance
 * is gone workflows do not queue or warn — they simply never start. This is the
 * replacement, and it is in some ways better: it fails before the push rather
 * than five minutes after it, in a tab you had already closed.
 *
 * The order is deliberate and it stops at the first failure. Typecheck is first
 * because it is the fastest way to find out you are wrong, and the build is
 * last because it is the slowest and nothing else depends on it having run.
 *
 * `db:test` is the one step that can be skipped rather than failed. It needs a
 * local Postgres, and a machine without one should still be able to run the
 * rest. But the RLS assertions are the checks most worth having — they are what
 * proves one couple cannot read another's rows — so a skip is reported loudly
 * and counted separately in the summary, never folded in with the passes.
 */
import { spawnSync } from 'node:child_process'

const ESC = String.fromCharCode(27)
const GREEN = `${ESC}[32m`
const RED = `${ESC}[31m`
const YELLOW = `${ESC}[33m`
const DIM = `${ESC}[2m`
const RESET = `${ESC}[0m`

function hasPostgres() {
  const probe = spawnSync('pg_isready', ['-q'], { stdio: 'ignore' })
  return probe.status === 0
}

const steps = [
  { name: 'typecheck', cmd: 'npm', args: ['run', 'typecheck'] },
  { name: 'lint', cmd: 'npm', args: ['run', 'lint'] },
  { name: 'tests', cmd: 'npm', args: ['run', 'test:run'] },
  {
    name: 'setup.sql matches the migrations',
    cmd: 'node',
    args: ['scripts/build-setup.mjs', '--check'],
  },
  {
    name: 'migrations and RLS',
    cmd: 'npm',
    args: ['run', 'db:test'],
    // Skipped rather than failed when there is no database to run it against.
    skipUnless: hasPostgres,
    skipReason:
      'no local Postgres reachable. This is the step that proves one couple\n' +
      '     cannot read the other couple’s rows — docs/CI.md has a two-line install.',
  },
  {
    name: 'build',
    cmd: 'npm',
    args: ['run', 'build'],
    env: {
      // The real values live in the host. These only have to parse.
      NEXT_PUBLIC_SUPABASE_URL: 'https://placeholder.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'placeholder-anon-key',
    },
  },
]

let skipped = 0
const started = Date.now()

for (const step of steps) {
  if (step.skipUnless && !step.skipUnless()) {
    console.log(`${YELLOW}o${RESET} ${step.name} ${DIM}— skipped${RESET}`)
    console.log(`     ${step.skipReason}`)
    skipped += 1
    continue
  }

  process.stdout.write(`${DIM}·${RESET} ${step.name}…`)
  const at = Date.now()
  const run = spawnSync(step.cmd, step.args, {
    stdio: 'pipe',
    encoding: 'utf8',
    env: { ...process.env, ...step.env },
    shell: process.platform === 'win32',
  })
  const seconds = ((Date.now() - at) / 1000).toFixed(1)

  if (run.status === 0) {
    // Quiet on success. The whole point of this script is the one line that is
    // not a tick.
    process.stdout.write(`\r${GREEN}✓${RESET} ${step.name} ${DIM}${seconds}s${RESET}\n`)
    continue
  }

  process.stdout.write(`\r${RED}✗${RESET} ${step.name} ${DIM}${seconds}s${RESET}\n\n`)
  // Both streams: eslint and tsc report on stdout, vitest and psql on stderr,
  // and printing only one of them is how a failure becomes a mystery.
  if (run.stdout) process.stdout.write(run.stdout)
  if (run.stderr) process.stderr.write(run.stderr)
  process.exit(run.status ?? 1)
}

const total = ((Date.now() - started) / 1000).toFixed(1)
if (skipped > 0) {
  const plural = skipped === 1 ? '' : 's'
  console.log(`\n${YELLOW}Passed, with ${skipped} step${plural} skipped${RESET} ${DIM}${total}s${RESET}`)
  console.log(`${DIM}A skip is not a pass. See docs/CI.md.${RESET}`)
} else {
  console.log(`\n${GREEN}All checks passed${RESET} ${DIM}${total}s${RESET}`)
}
