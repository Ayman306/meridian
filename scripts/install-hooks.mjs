#!/usr/bin/env node
/**
 * Install a pre-push hook that runs `npm run verify`.
 *
 * Opt-in rather than automatic. A postinstall that writes into `.git` without
 * being asked is the kind of thing that makes people distrust a repo, and the
 * hook slows every push — that should be somebody's decision rather than a side
 * effect of `npm install`.
 *
 * It refuses to overwrite a hook it did not write. Somebody with their own
 * pre-push has it for a reason.
 */
import { existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const MARKER = '# meridian-verify'
const HOOK = `#!/bin/sh
${MARKER}
# Runs the checks CI used to run. Bypass with: git push --no-verify
npm run verify
`

const root = process.cwd()
const path = join(root, '.git', 'hooks', 'pre-push')

if (!existsSync(join(root, '.git'))) {
  console.error('Not a git repository — nothing to install into.')
  process.exit(1)
}

if (existsSync(path) && !readFileSync(path, 'utf8').includes(MARKER)) {
  console.error(`There is already a pre-push hook at ${path} that this did not write.`)
  console.error('Left alone — merge it by hand if you want both.')
  process.exit(1)
}

mkdirSync(join(root, '.git', 'hooks'), { recursive: true })
writeFileSync(path, HOOK)
chmodSync(path, 0o755)

console.log('Installed .git/hooks/pre-push — `npm run verify` now runs before every push.')
console.log('Remove it with: rm .git/hooks/pre-push')
