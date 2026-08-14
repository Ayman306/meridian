import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HARD_CAPS, LIMITS } from '@/lib/flights/providers'

describe('the spend ceiling', () => {
  it('stops below what the plan bills for', () => {
    // The promise is "no more than 550 of the 600 I pay for".
    expect(HARD_CAPS.aerodatabox).toBe(550)
    expect(HARD_CAPS.aerodatabox).toBeLessThan(LIMITS.aerodatabox)
  })

  it('leaves headroom on every provider, not just the metered one', () => {
    for (const provider of Object.keys(HARD_CAPS) as (keyof typeof HARD_CAPS)[]) {
      expect(HARD_CAPS[provider]).toBeLessThan(LIMITS[provider])
    }
  })
})

/**
 * A key in the repository is a key in everybody's clone, on every branch,
 * forever — `git rm` does not remove it from history. Cheaper to make it
 * impossible to commit one than to rotate it afterwards.
 */
describe('no API keys in the tree', () => {
  const SUSPECT = [
    // RapidAPI keys are 50 characters of base36 with an 'msh' marker.
    /[a-z0-9]{8,}msh[a-z0-9]{10,}/i,
    // An assignment that looks like a real key rather than a placeholder.
    /(?:api[_-]?key|secret|token)\s*[:=]\s*['"][A-Za-z0-9_\-]{24,}['"]/i,
  ]

  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      if (entry === 'node_modules' || entry === '.git' || entry === '.next') return []
      const full = join(dir, entry)
      return statSync(full).isDirectory() ? walk(full) : [full]
    })

  const files = [...walk('src'), ...walk('supabase'), '.env.example'].filter((f) =>
    /\.(ts|tsx|sql|example|md|json|ya?ml)$/.test(f),
  )

  it('scans a meaningful number of files', () => {
    // Guards the guard: a walk that silently returns nothing would pass.
    expect(files.length).toBeGreaterThan(50)
  })

  it('finds no key-shaped strings', () => {
    const offenders = files.filter((file) => {
      const text = readFileSync(file, 'utf8')
      return SUSPECT.some((pattern) => pattern.test(text))
    })
    expect(offenders).toEqual([])
  })

  it('never prefixes a provider key with NEXT_PUBLIC_', () => {
    // The one mistake that would put a key in the browser bundle.
    const offenders = files.filter((file) =>
      /NEXT_PUBLIC_[A-Z_]*(API_KEY|SECRET|TOKEN|SERVICE_ROLE)/.test(readFileSync(file, 'utf8')),
    )
    expect(offenders).toEqual([])
  })
})
