'use client'

/**
 * The client half of the route guards.
 *
 * Whether someone is signed in is settled on the server, before this renders.
 * Whether they are *paired* and *set up* depends on the couple query, which is
 * client state, so it is decided here.
 */
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { PageLoading } from '@/components/common/states'
import { useCouple } from '@/providers/CoupleProvider'
import { needsProfileSetup } from '@/modules/auth'

export function AppGate({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const { isSolo, self, isLoading } = useCouple()
  const needsSetup = !isLoading && needsProfileSetup(self)

  useEffect(() => {
    if (isLoading) return
    // Solo mode is a real, potentially long-lived state, not an error — the
    // partner may join days later. Send them somewhere useful.
    if (isSolo) router.replace('/pair')
    else if (needsSetup) router.replace('/setup')
  }, [isLoading, isSolo, needsSetup, router])

  if (isLoading || isSolo || needsSetup) {
    return (
      <div className="container py-16">
        <PageLoading />
      </div>
    )
  }

  return <>{children}</>
}
