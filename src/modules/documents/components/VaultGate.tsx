/**
 * The idle lock on the vault. Spec 8.3.
 *
 * `vault_lock_minutes` has been stored since Phase 13 and enforced by nothing,
 * which made it a setting that quietly did nothing — worse than not offering it,
 * because somebody set it to five and believed it.
 *
 * ## What this is and is not
 *
 * It is a **screen lock**, not an access control. RLS is what stops anybody
 * reading these rows; this stops a passport scan being on screen when a phone
 * is handed over or left on a table, which is a real and different risk.
 *
 * Saying so plainly matters, because a re-auth prompt implies a stronger
 * guarantee than it gives: the data has already been fetched, and anyone with
 * the device and the browser's storage could reach it regardless. The honest
 * claim is "not left visible", and that is what the copy says.
 *
 * ## Why re-entering is a button rather than a password
 *
 * There is no password to re-enter — sign-in is Google OAuth. Asking for one
 * would mean inventing a second credential to store, which is a worse position
 * than the one this is protecting against. So it clears the screen and requires
 * a deliberate action to bring it back, which is the whole of what it can
 * honestly offer. Signing out entirely is offered alongside, and that one does
 * end the session.
 */
'use client'

import { useEffect, useRef, useState } from 'react'
import { Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

/** Events that count as being at the device. Deliberately broad. */
const ACTIVITY = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const

export function VaultGate({
  lockMinutes,
  onSignOut,
  children,
}: {
  /** Zero or null turns it off, which is what the settings copy promises. */
  lockMinutes: number | null | undefined
  onSignOut?: () => void
  children: React.ReactNode
}) {
  const [locked, setLocked] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const minutes = lockMinutes ?? 0
    if (minutes <= 0 || locked) return

    const reset = () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setLocked(true), minutes * 60_000)
    }

    reset()
    for (const event of ACTIVITY) {
      window.addEventListener(event, reset, { passive: true })
    }
    // Hiding the tab is not idleness — but coming back to it after a while is
    // exactly when the screen should already be clear, so the timer keeps
    // running rather than pausing. A backgrounded tab counts as away.
    document.addEventListener('visibilitychange', reset)

    return () => {
      if (timer.current) clearTimeout(timer.current)
      for (const event of ACTIVITY) window.removeEventListener(event, reset)
      document.removeEventListener('visibilitychange', reset)
    }
  }, [lockMinutes, locked])

  if (!locked) return <>{children}</>

  return (
    <Card className="mx-auto mt-12 max-w-md space-y-4 p-6 text-center">
      <Lock className="mx-auto size-6 text-muted-foreground" aria-hidden="true" />
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">The vault is hidden</h2>
        <p className="text-sm text-muted-foreground">
          You have been idle for {lockMinutes} minutes, so your documents are off the screen. This
          hides them from whoever can see the device — it is not a second lock on the data itself.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Button onClick={() => setLocked(false)}>Show them again</Button>
        {onSignOut && (
          <Button variant="ghost" onClick={onSignOut}>
            Sign out instead
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Change or switch this off under Settings → Lock the vault after.
      </p>
    </Card>
  )
}
