'use client'

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase/client'
import { queryClient } from '@/lib/queryClient'
import { identityChanged } from '@/modules/auth/logic'
import { clearServiceWorkerCaches } from '@/lib/pwa/register'
import * as authApi from '@/modules/auth/api'

interface AuthContextValue {
  session: Session | null
  user: User | null
  /** True until the initial session read resolves — not on every refresh. */
  isLoading: boolean
  signIn: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  // Who the cache currently belongs to. A ref rather than state because it is
  // read and written inside the subscription callback and must not schedule a
  // render of its own.
  const cachedUserId = useRef<string | null>(null)

  useEffect(() => {
    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      cachedUserId.current = data.session?.user.id ?? null
      setSession(data.session)
      setIsLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      const nextUserId = next?.user.id ?? null

      // A different user must never see the previous user's cache. Keyed on the
      // identity rather than the event name — see `identityChanged`, and note
      // that supabase-js fires SIGNED_IN on every tab focus. Clearing on the
      // event emptied the whole cache each time the tab was switched away from
      // and back, which put every screen into its loading state and read as the
      // app spontaneously reloading.
      if (identityChanged(cachedUserId.current, nextUserId)) {
        cachedUserId.current = nextUserId
        queryClient.clear()
      }

      // Hold the previous object when nothing material moved, so a focus event
      // does not re-render every consumer of this context for no reason.
      setSession((prev) =>
        prev?.user.id === nextUserId && prev?.access_token === next?.access_token ? prev : next,
      )
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      isLoading,
      signIn: () => authApi.signInWithGoogle(),
      signOut: async () => {
        await authApi.signOut()
        queryClient.clear()
        // Nothing user-specific is in the service worker's caches by design,
        // but a device changing hands should not keep even a shell. Failing
        // here must not block the sign-out itself.
        void clearServiceWorkerCaches().catch(() => {})
      },
    }),
    [session, isLoading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
