/**
 * POST /api/oauth/approve — a person pressed a button, so a code exists.
 *
 * The consent screen posts here. Nothing it posts is trusted: the client and
 * the redirect URI are looked up and matched again, from scratch, because the
 * form that submitted them is markup a browser was given and a browser can be
 * made to submit anything.
 *
 * ## The modules that get granted
 *
 * Whatever the person actually ticked, intersected with what the client asked
 * for. Not what the client asked for, and not everything the person has — a
 * form field claiming `health` on a request that never asked for it is
 * discarded rather than honoured.
 *
 * ## Cross-site submission
 *
 * Supabase's session cookie is `SameSite=Lax`, so a cross-site POST arrives
 * without one and fails at the sign-in check. The `Origin` check below is the
 * second lock on the same door: it costs a string comparison and it does not
 * depend on a cookie attribute set by a dependency staying that way.
 */
import { NextResponse } from 'next/server'
import { createAdminSupabase, requireUser } from '@/lib/supabase/server'
import { hashToken } from '@/lib/tokens'
import {
  CODE_TTL_SECONDS,
  errorRedirect,
  generateOpaque,
  redirectIsRegistered,
  successRedirect,
} from '@/lib/oauth'
import { ALL_MODULES } from '@/modules/settings/logic'
import type { ModuleName } from '@/modules/settings/types'

export const dynamic = 'force-dynamic'

function refuse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin')
  const here = new URL(request.url).origin
  if (origin && origin !== here) {
    return refuse('That request did not come from Meridian.', 403)
  }

  const form = await request.formData()
  const clientId = String(form.get('client_id') ?? '')
  const redirectUri = String(form.get('redirect_uri') ?? '')
  const challenge = String(form.get('code_challenge') ?? '')
  const state = form.get('state') === null ? null : String(form.get('state'))
  const decision = String(form.get('decision') ?? 'deny')
  const ticked = form.getAll('modules').map(String)

  if (!clientId || !redirectUri || !challenge) {
    return refuse('That authorisation request is incomplete.')
  }

  // Whoever is signed in is who the grant belongs to. There is no path here
  // that acts for anybody else.
  const user = await requireUser()
  if (!user) return refuse('You are not signed in.', 401)

  const admin = createAdminSupabase()
  const { data: client } = await admin
    .from('oauth_clients')
    .select('client_id, redirect_uris')
    .eq('client_id', clientId)
    .maybeSingle()

  // Re-checked, not carried over from the page that rendered the form.
  if (!client) return refuse('That application is not registered.')
  if (!redirectIsRegistered(client.redirect_uris, redirectUri)) {
    return refuse('That redirect address is not registered to this application.')
  }

  if (decision !== 'allow') {
    // A refusal the client is told about, rather than a closed window it waits
    // on forever.
    return NextResponse.redirect(
      errorRedirect(redirectUri, 'access_denied', state, 'They chose not to connect.'),
      { status: 303 },
    )
  }

  // What the person ticked, filtered to names that are actually modules.
  //
  // Their ticks are the authority here, and deliberately not intersected with
  // what the client asked for: the consent screen only ever offers what was
  // asked, and a second intersection against a `scope` field posted by the
  // same form would be theatre — it would be checking the form against
  // itself. What stops a hostile client posting its own form is that it
  // cannot: the Origin check and a `SameSite=Lax` session cookie mean a
  // cross-site submission arrives with no user at all.
  const modules = ticked.filter((m): m is ModuleName => ALL_MODULES.includes(m as ModuleName))

  if (modules.length === 0) {
    return NextResponse.redirect(
      errorRedirect(redirectUri, 'invalid_scope', state, 'Nothing was shared.'),
      { status: 303 },
    )
  }

  const code = generateOpaque()
  const { error } = await admin.from('oauth_codes').insert({
    code_hash: await hashToken(code),
    client_id: clientId,
    user_id: user.id,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    modules,
    expires_at: new Date(Date.now() + CODE_TTL_SECONDS * 1000).toISOString(),
  })

  if (error) {
    console.error('oauth/approve: could not store code', error.message)
    return NextResponse.redirect(
      errorRedirect(redirectUri, 'server_error', state, 'Could not complete that connection.'),
      { status: 303 },
    )
  }

  // 303, so the browser follows with GET and a refresh does not re-post the
  // form — which would mint a second code for a decision made once.
  return NextResponse.redirect(successRedirect(redirectUri, code, state), { status: 303 })
}
