/**
 * What this person may see, app-wide.
 *
 * The answer comes from the database — `my_modules()` and `my_role()` — rather
 * than from anything computed here. That matters: the same `couple_members`
 * row drives both this and every RLS policy, so a nav item that is hidden and
 * a table that returns nothing can never disagree. Hiding a link is a
 * courtesy; the policy is the guarantee.
 *
 * Nobody should read this to decide whether data is *safe* to show. By the
 * time a row reaches the browser the database has already decided. This exists
 * so the app does not offer a screen that would come back empty.
 */
'use client'

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useCouple } from '@/providers/CoupleProvider'
import { useMyAccess } from '@/modules/settings/hooks'
import { ALL_MODULES } from '@/modules/settings/logic'
import type { MemberRole, ModuleName } from '@/modules/settings/types'

interface AccessContextValue {
  role: MemberRole | null
  modules: ModuleName[]
  can: (module: ModuleName) => boolean
  /** True for the people the space belongs to: they invite, and set shared preferences. */
  isOwning: boolean
  isLoading: boolean
}

const AccessContext = createContext<AccessContextValue | null>(null)

export function AccessProvider({ children }: { children: ReactNode }) {
  const { coupleId, isSolo } = useCouple()
  const { role, modules, isLoading } = useMyAccess()

  const value = useMemo<AccessContextValue>(() => {
    // Solo mode is not restricted access — there is nobody to be restricted
    // by. Someone who has not paired yet sees the whole app.
    const effective: ModuleName[] = !coupleId || isSolo ? ALL_MODULES : modules
    const owning = !coupleId || isSolo || role === 'owner' || role === 'partner'

    return {
      role,
      modules: effective,
      can: (module: ModuleName) => effective.includes(module),
      isOwning: owning,
      isLoading: Boolean(coupleId) && isLoading,
    }
  }, [coupleId, isSolo, modules, role, isLoading])

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>
}

export function useAccess() {
  const ctx = useContext(AccessContext)
  if (!ctx) throw new Error('useAccess must be used inside AccessProvider')
  return ctx
}
