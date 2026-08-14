import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ALL_MODULES,
  DEFAULT_GUEST_MODULES,
  MODULE_DESCRIPTIONS,
  MODULE_LABELS,
  SENSITIVE_MODULES,
  canGrant,
  canSee,
  describeAccess,
  isOwning,
  isSensitive,
  normaliseGrants,
  visibleModules,
} from '@/modules/settings/logic'
import type { ModuleName } from '@/modules/settings/types'

describe('roles', () => {
  it('knows which two the space belongs to', () => {
    expect(isOwning('owner')).toBe(true)
    expect(isOwning('partner')).toBe(true)
    expect(isOwning('friend')).toBe(false)
    expect(isOwning('guest')).toBe(false)
  })
})

describe('what can be granted', () => {
  it('lets the couple see everything', () => {
    for (const name of ALL_MODULES) {
      expect(canGrant('owner', name)).toBe(true)
      expect(canGrant('partner', name)).toBe(true)
    }
  })

  it('never grants the sensitive three to a friend or a guest', () => {
    // The rule the whole access model turns on. Documents are passport
    // numbers, allowance is immigration history, health is health.
    for (const name of SENSITIVE_MODULES) {
      expect(canGrant('friend', name)).toBe(false)
      expect(canGrant('guest', name)).toBe(false)
    }
  })

  it('lets a friend hold anything that is not sensitive', () => {
    const shareable = ALL_MODULES.filter((m) => !isSensitive(m))
    expect(shareable.length).toBeGreaterThan(0)
    for (const name of shareable) expect(canGrant('friend', name)).toBe(true)
  })

  it('offers a guest default that leaks nothing', () => {
    for (const name of DEFAULT_GUEST_MODULES) expect(isSensitive(name)).toBe(false)
  })
})

describe('what a member actually sees', () => {
  it('gives the couple the whole app', () => {
    expect(visibleModules('partner', null)).toEqual(ALL_MODULES)
  })

  it('gives a limited role only what they hold', () => {
    expect(visibleModules('friend', ['trips', 'photos'])).toEqual(['trips', 'photos'])
    expect(canSee('trips', 'friend', ['trips', 'photos'])).toBe(true)
    expect(canSee('money', 'friend', ['trips', 'photos'])).toBe(false)
  })

  it('drops a sensitive grant even if one somehow reaches it', () => {
    // Defence in depth: the database refuses the write, and this refuses to
    // render it. Neither is relied on alone.
    expect(visibleModules('friend', ['trips', 'documents', 'health'])).toEqual(['trips'])
    expect(canSee('documents', 'guest', ['documents'])).toBe(false)
  })

  it('treats a null grant on a limited role as nothing, not everything', () => {
    // The dangerous reading. Null means "everything" only for the two people
    // the space belongs to; for anyone else it must fail closed.
    expect(visibleModules('friend', null)).toEqual([])
    expect(visibleModules('guest', null)).toEqual([])
  })

  it('returns modules in a stable order whatever order they were given', () => {
    expect(visibleModules('friend', ['photos', 'trips'])).toEqual(
      visibleModules('friend', ['trips', 'photos']),
    )
  })
})

describe('normalising a proposed grant', () => {
  it('strips what the role may not hold', () => {
    expect(normaliseGrants('friend', ['trips', 'documents'])).toEqual(['trips'])
  })

  it('keeps everything for the couple', () => {
    expect(normaliseGrants('partner', ['documents', 'health'])).toEqual(['documents', 'health'])
  })

  it('ignores anything that is not a module', () => {
    expect(normaliseGrants('friend', ['trips', 'nonsense' as ModuleName])).toEqual(['trips'])
  })

  it('is idempotent', () => {
    const once = normaliseGrants('friend', ['photos', 'trips', 'health'])
    expect(normaliseGrants('friend', once)).toEqual(once)
  })
})

describe('the sentence on the access screen', () => {
  it('says everything when it is everything', () => {
    expect(describeAccess('partner', null)).toBe('Everything')
  })

  it('names them when there are few', () => {
    expect(describeAccess('friend', ['trips', 'photos'])).toBe('Trips and the plan, Photos')
  })

  it('counts them when there are many', () => {
    expect(describeAccess('friend', ['trips', 'wishlist', 'destinations', 'photos'])).toBe(
      `4 of ${ALL_MODULES.length} modules`,
    )
  })

  it('does not pretend an empty grant is access', () => {
    expect(describeAccess('guest', [])).toBe('Nothing yet')
  })
})

describe('every module is described', () => {
  it('has a label and a description', () => {
    for (const name of ALL_MODULES) {
      expect(MODULE_LABELS[name]).toBeTruthy()
      expect(MODULE_DESCRIPTIONS[name]).toBeTruthy()
    }
  })
})

/**
 * The TypeScript lists above are a mirror of `all_modules()` and
 * `sensitive_modules()` in migration 0013. The database is the enforcement
 * point; these exist so the UI can explain the same rules. Duplication is only
 * safe if it cannot drift, so this reads the migration and checks.
 */
describe('the TS lists match the SQL', () => {
  const sql = readFileSync('supabase/migrations/0013_settings_and_access.sql', 'utf8')

  const arrayFrom = (fn: string): string[] => {
    const body = sql.slice(sql.indexOf(`function public.${fn}()`))
    const literal = body.slice(body.indexOf('array['), body.indexOf(']', body.indexOf('array[')))
    return [...literal.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!)
  }

  it('lists exactly the modules all_modules() does', () => {
    expect([...ALL_MODULES].sort()).toEqual([...arrayFrom('all_modules')].sort())
  })

  it('marks exactly the modules sensitive_modules() does', () => {
    expect([...SENSITIVE_MODULES].sort()).toEqual([...arrayFrom('sensitive_modules')].sort())
  })
})
