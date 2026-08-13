import { redirect } from 'next/navigation'
import { requireUser } from '@/lib/supabase/server'
import { AppShell } from '@/components/layout/AppShell'
import { AppGate } from '@/components/layout/AppGate'

/**
 * Everything inside the app proper. Sign-in is checked on the server, so an
 * unauthenticated request never ships the app's JavaScript at all.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()
  if (!user) redirect('/login')

  return (
    <AppGate>
      <AppShell>{children}</AppShell>
    </AppGate>
  )
}
