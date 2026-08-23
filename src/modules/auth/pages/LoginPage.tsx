'use client'

import { useState } from 'react'
import { useAuth } from '@/providers/AuthProvider'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/common/states'
import { AppError } from '@/lib/errors'
import { APP_NAME } from '@/lib/constants'

export function LoginPage({
  callbackError = null,
  next = '/',
}: {
  callbackError?: string | null
  /**
   * Where to land afterwards. Set when sign-in interrupted something — an
   * assistant's authorisation flow, most of all, where bouncing to the
   * dashboard would silently abandon a connection the person was making.
   */
  next?: string
}) {
  // Sign-in state is settled on the server before this renders, so there is
  // no redirect to do here.
  const { signIn } = useAuth()
  const [error, setError] = useState<unknown>(
    // A failed callback lands back here with a reason. Showing it is the
    // difference between "the redirect URL is not on the allowlist" and an
    // unexplained bounce to the sign-in screen.
    callbackError ? new AppError(callbackError, { kind: 'auth' }) : null,
  )
  const [pending, setPending] = useState(false)

  const onSignIn = async () => {
    setPending(true)
    setError(null)
    try {
      await signIn(next)
    } catch (e) {
      setError(e)
      setPending(false)
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-8 text-center">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">{APP_NAME}</h1>
          <p className="text-muted-foreground">
            Two passports, two time zones, one shared trip.
          </p>
        </div>

        <Button size="lg" className="w-full" onClick={onSignIn} disabled={pending}>
          {pending ? 'Opening Google…' : 'Continue with Google'}
        </Button>

        {error ? <ErrorState error={error} title="Sign-in failed" onRetry={onSignIn} /> : null}

        <p className="text-xs text-muted-foreground">
          We only ask Google for your name, email and picture.
        </p>
      </div>
    </main>
  )
}
