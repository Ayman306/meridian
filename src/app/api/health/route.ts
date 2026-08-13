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
import { toAppError } from '@/lib/errors'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = await createServerSupabase()
    const { data, error } = await supabase.rpc('health')
    if (error) throw error
    return NextResponse.json({ ok: true, database: data })
  } catch (e) {
    // Say what actually failed. A Postgrest error is not an Error instance, so
    // reading `.message` off it directly reports nothing useful — which is
    // exactly what you don't want from the endpoint you check when things break.
    const err = toAppError(e)
    console.error('health check failed', err.kind, err.code, err.cause)
    return NextResponse.json(
      { ok: false, kind: err.kind, code: err.code ?? null, error: err.message },
      { status: 503 },
    )
  }
}
