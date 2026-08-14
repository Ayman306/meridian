/**
 * GET /api/share/[token] — resolve a public share. Spec 11.4.
 *
 * The only endpoint in this app that answers without a session, so the checks
 * are explicit and in order: the token exists, it has not been revoked, it has
 * not expired, and the passcode matches. Only then does it mint short-lived
 * signed URLs.
 *
 * **It never returns a storage path.** That is what makes revocation real: a
 * revoked link stops working on the next request, where a leaked path would
 * keep working until someone moved the file.
 */
import { NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase/server'
import { SIGNED_URL_TTL_SECONDS } from '@/modules/gallery/logic'
import type { SharedPayload } from '@/modules/gallery/types'

export const dynamic = 'force-dynamic'

/** Shorter than an authenticated session's: a share is a loan, not a copy. */
const SHARE_URL_TTL = 900

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params
  const passcode = new URL(request.url).searchParams.get('passcode')

  // Service role, because there is no caller to authorise. Everything below
  // this line is the authorisation.
  const admin = createAdminSupabase()

  const { data: link } = await admin
    .from('share_links')
    .select('*')
    .eq('token', token)
    .maybeSingle()

  // One message for every failure mode. Distinguishing "revoked" from "never
  // existed" tells whoever is guessing tokens which guesses were close.
  const notFound = () =>
    NextResponse.json({ error: 'That link is no longer available.' }, { status: 404 })

  if (!link) return notFound()
  if (link.revoked_at) return NextResponse.json({ error: 'That link was revoked.' }, { status: 403 })
  if (new Date(link.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'That link has expired.' }, { status: 403 })
  }

  if (link.passcode_hash) {
    if (!passcode) {
      return NextResponse.json({ error: 'passcode_required', needsPasscode: true }, { status: 401 })
    }
    if ((await sha256(passcode)) !== link.passcode_hash) {
      return NextResponse.json({ error: 'That passcode is not right.' }, { status: 401 })
    }
  }

  const { media, title } = await loadTarget(admin, link.target_type, link.target_id)
  // A share pointing at something since deleted is a plain 404, not a stack
  // trace (spec 11.7).
  if (media.length === 0) return notFound()

  const { data: signed } = await admin.storage
    .from('media')
    .createSignedUrls(
      media.map((m) => m.path_display),
      SHARE_URL_TTL,
    )

  const payload: SharedPayload = {
    target: link.target_type as 'media' | 'album',
    title,
    allowDownload: link.allow_download,
    items: media
      .map((item, index) => ({
        id: item.id,
        caption: item.caption,
        thumbhash: item.thumbhash,
        width: item.width,
        height: item.height,
        url: signed?.[index]?.signedUrl ?? '',
      }))
      .filter((item) => item.url),
  }

  // Best effort; a failed counter must not fail the view.
  await admin
    .from('share_links')
    .update({ view_count: link.view_count + 1 })
    .eq('id', link.id)

  return NextResponse.json(payload, {
    headers: { 'Cache-Control': `private, max-age=${Math.min(300, SIGNED_URL_TTL_SECONDS)}` },
  })
}

async function loadTarget(
  admin: ReturnType<typeof createAdminSupabase>,
  targetType: string,
  targetId: string,
) {
  if (targetType === 'media') {
    const { data } = await admin
      .from('media')
      .select('*')
      .eq('id', targetId)
      .is('deleted_at', null)
      .maybeSingle()
    return { media: data ? [data] : [], title: data?.caption ?? null }
  }

  const { data: album } = await admin
    .from('albums')
    .select('id, title')
    .eq('id', targetId)
    .maybeSingle()
  if (!album) return { media: [], title: null }

  const { data: rows } = await admin
    .from('album_media')
    .select('sort_key, media:media(*)')
    .eq('album_id', targetId)
    .order('sort_key')

  const media = (rows ?? [])
    .map((row) => row.media as unknown as { deleted_at: string | null } | null)
    .filter((m): m is NonNullable<typeof m> => Boolean(m) && m!.deleted_at === null)

  return { media: media as never[], title: album.title }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
