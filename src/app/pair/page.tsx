import { redirect } from 'next/navigation'
import { requireUser } from '@/lib/supabase/server'
import { PairPage } from '@/modules/auth'

export default async function Pair() {
  if (!(await requireUser())) redirect('/login')
  return <PairPage />
}
