import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '@/providers/AuthProvider'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/common/states'
import { APP_NAME } from '@/lib/constants'

export function LoginPage() {
  const { session, isLoading, signIn } = useAuth()
  const [error, setError] = useState<unknown>(null)
  const [pending, setPending] = useState(false)

  if (isLoading) return null
  if (session) return <Navigate to="/" replace />

  const onSignIn = async () => {
    setPending(true)
    setError(null)
    try {
      await signIn()
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
