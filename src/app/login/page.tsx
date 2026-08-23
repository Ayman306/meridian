import { redirect } from 'next/navigation'
import { requireUser } from '@/lib/supabase/server'
import { LoginPage } from '@/modules/auth'
import { safeRedirectPath } from '@/modules/auth/logic'

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>
}) {
  // Already signed in — nothing to do here.
  const { error, next } = await searchParams
  // `next` is validated to a local path before it is used anywhere, including
  // in the already-signed-in case: an open redirect here would hand a live
  // session to another site.
  const destination = safeRedirectPath(next)
  if (await requireUser()) redirect(destination)
  // The callback handler redirects here with a reason when the exchange fails.
  // Without showing it, a misconfigured redirect URL looks like a silent bounce.
  return <LoginPage callbackError={error ?? null} next={destination} />
}
