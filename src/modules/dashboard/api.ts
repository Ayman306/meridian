/** Module 2 — Dashboard. One RPC, one round trip (spec 2.4). */
'use client'

import { supabase } from '@/lib/supabase/client'
import { toAppError } from '@/lib/errors'
import type { DashboardPayload } from './types'

export async function getDashboard(): Promise<DashboardPayload> {
  const { data, error } = await supabase.rpc('dashboard')
  if (error) throw toAppError(error)
  return (data ?? { paired: false }) as unknown as DashboardPayload
}
