/**
 * Keep-alive endpoint. A free-tier Supabase project pauses after about seven
 * days idle, which would take the app down silently between trips — so a
 * GitHub Action pings this every two days (spec 0.10).
 *
 * It touches the database deliberately: an endpoint that only proves Next is
 * awake would keep passing while Postgres slept.
 */
import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = await createServerSupabase()
    const { data, error } = await supabase.rpc('health')
    if (error) throw error
    return NextResponse.json({ ok: true, database: data })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'unknown' },
      { status: 503 },
    )
  }
}
