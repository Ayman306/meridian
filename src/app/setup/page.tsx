import { redirect } from 'next/navigation'
import { requireUser } from '@/lib/supabase/server'
import { SetupPage } from '@/modules/auth'

export default async function Setup() {
  if (!(await requireUser())) redirect('/login')
  return <SetupPage />
}
