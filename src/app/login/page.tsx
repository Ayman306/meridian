import { redirect } from 'next/navigation'
import { requireUser } from '@/lib/supabase/server'
import { LoginPage } from '@/modules/auth'

export default async function Login() {
  // Already signed in — nothing to do here.
  if (await requireUser()) redirect('/')
  return <LoginPage />
}
