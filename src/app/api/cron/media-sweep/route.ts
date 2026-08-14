/**
 * POST /api/cron/media-sweep — hard-delete what has been in the trash 30 days.
 *
 * **Order matters, and the spec says so explicitly: objects first, then rows.**
 *
 * Deleting the rows first destroys the only record of which files existed.
 * Those files then sit in the bucket forever, invisible to the app and
 * counted against a one-gigabyte quota — the exact failure this module cannot
 * afford. So the function returns the paths, the objects go, and only then are
 * the rows purged.
 *
 * A partial failure is safe in this order: a row whose objects are already
 * gone is picked up again on the next sweep and purged then.
 */
import { NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase/server'
import { assertCronRequest } from '@/lib/cron'
import { toAppError } from '@/lib/errors'
import { SOFT_DELETE_GRACE_DAYS } from '@/lib/constants'

export const dynamic = 'force-dynamic'

/** Storage removals go in batches; a thousand paths in one call is plenty. */
const BATCH = 100

export async function POST(request: Request) {
  try {
    assertCronRequest(request)
  } catch (e) {
    return NextResponse.json({ error: toAppError(e).message }, { status: 401 })
  }

  const admin = createAdminSupabase()

  const { data: expired, error } = await admin.rpc('expired_media', {
    grace_days: SOFT_DELETE_GRACE_DAYS,
  })

  if (error) {
    console.error('media sweep: could not list expired media', error.message)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  const rows = expired ?? []
  if (rows.length === 0) return NextResponse.json({ ok: true, purged: 0, objects: 0 })

  const paths = rows.flatMap((row) =>
    [row.path_display, row.path_thumb, row.path_original].filter((p): p is string => Boolean(p)),
  )

  let removed = 0
  const failedPaths: string[] = []

  for (let i = 0; i < paths.length; i += BATCH) {
    const batch = paths.slice(i, i + BATCH)
    const { error: removeError } = await admin.storage.from('media').remove(batch)
    if (removeError) {
      console.error('media sweep: object removal failed', removeError.message)
      failedPaths.push(...batch)
      continue
    }
    removed += batch.length
  }

  // Only purge rows whose objects are all gone. A row kept alive because its
  // file could not be deleted is picked up again next time; a row deleted with
  // its file still there is an orphan nobody will ever find.
  const stillHeld = new Set(failedPaths)
  const purgeable = rows
    .filter((row) =>
      [row.path_display, row.path_thumb, row.path_original]
        .filter((p): p is string => Boolean(p))
        .every((path) => !stillHeld.has(path)),
    )
    .map((row) => row.id)

  const { data: purged, error: purgeError } = await admin.rpc('purge_media', { ids: purgeable })

  if (purgeError) {
    console.error('media sweep: purge failed', purgeError.message)
    return NextResponse.json({ ok: false, objects: removed, error: purgeError.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    purged: purged ?? 0,
    objects: removed,
    held: failedPaths.length,
  })
}
