/**
 * Keep-alive endpoint. A free-tier Supabase project pauses after about seven
 * days idle, which would take the app down silently between trips — so a
 * Vercel cron calls this every day (spec 0.10, `vercel.json`).
 *
 * It touches the database deliberately: an endpoint that only proves Next is
 * awake would keep passing while Postgres slept.
 *
 * It also compares the schema the database is on with the one this build was
 * written for (D140). A merged migration that never reached production was
 * invisible until something failed against a missing column; now this page
 * says `drift: true` from the moment the code ships until the migration is
 * applied, and the daily call logs it. Drift is reported, not a 503: the
 * database is up, and the keep-alive has done its job.
 */
import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { toAppError } from '@/lib/errors'
import { SCHEMA_VERSION } from '@/lib/schemaVersion'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = await createServerSupabase()
    const { data, error } = await supabase.rpc('health')
    if (error) throw error

    // Null before 0039 is applied — which is itself drift.
    const live = (data as { schema?: number } | null)?.schema ?? null
    const drift = live !== SCHEMA_VERSION
    if (drift) {
      console.error('schema drift', { expected: SCHEMA_VERSION, live })
    }
    return NextResponse.json({
      ok: true,
      database: data,
      schema: { expected: SCHEMA_VERSION, live },
      drift,
    })
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
