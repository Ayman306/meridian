import { redirect } from 'next/navigation'
import { requireUser } from '@/lib/supabase/server'
import { LoginPage } from '@/modules/auth'

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  // Already signed in — nothing to do here.
  if (await requireUser()) redirect('/')
  // The callback handler redirects here with a reason when the exchange fails.
  // Without showing it, a misconfigured redirect URL looks like a silent bounce.
  const { error } = await searchParams
  return <LoginPage callbackError={error ?? null} />
}
