/**
 * POST /api/oauth/register — RFC 7591 dynamic client registration.
 *
 * An open registration endpoint reads alarming, so it is worth being exact
 * about what registering actually gets you: a name, and permission to appear
 * on a consent screen. That is all.
 *
 * A client id is not a credential. It authorises nothing, reads nothing, and
 * cannot be presented anywhere to obtain anything. Every grant in this system
 * still requires a person, signed in, looking at which modules were asked for,
 * pressing a button. Registration is how an unknown client gets far enough to
 * *ask*; the answer is still a human's.
 *
 * The MCP specification requires this endpoint, and the alternative — a
 * hand-maintained allowlist of client ids — would mean the owner editing a
 * table before a new phone could connect.
 *
 * ## What is refused here
 *
 * Redirect URIs are validated at registration rather than only at redemption,
 * so a client that could never work fails immediately with a readable reason
 * instead of at the end of a flow a person has already walked through.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminSupabase } from '@/lib/supabase/server'
import { generateClientId, isRegisterableRedirect } from '@/lib/oauth'

export const dynamic = 'force-dynamic'

/** How many redirect URIs one client may claim. Real clients register one or two. */
const MAX_REDIRECT_URIS = 5

const registrationSchema = z.object({
  redirect_uris: z.array(z.string()).min(1).max(MAX_REDIRECT_URIS),
  // The client's claim about itself. Shown to a person, so it is bounded and
  // rendered as text — never as markup — at the consent screen.
  client_name: z.string().trim().min(1).max(80).optional(),
  // Accepted and ignored, because RFC 7591 sends them and rejecting a
  // registration over a field we do not use would fail real clients.
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  token_endpoint_auth_method: z.string().optional(),
  scope: z.string().optional(),
})

function badRequest(error: string, description: string) {
  return NextResponse.json({ error, error_description: description }, { status: 400 })
}

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return badRequest('invalid_client_metadata', 'That was not JSON.')
  }

  const parsed = registrationSchema.safeParse(body)
  if (!parsed.success) {
    return badRequest('invalid_client_metadata', 'redirect_uris is required.')
  }

  // Every URI, not just the first. A client that registers one good and one
  // hostile URI would otherwise get both accepted and choose at redemption.
  const bad = parsed.data.redirect_uris.find((uri) => !isRegisterableRedirect(uri))
  if (bad) {
    return badRequest(
      'invalid_redirect_uri',
      `${bad} cannot be registered. Use https, http on loopback, or a private-use scheme, with no fragment.`,
    )
  }

  // A confidential client would need a secret, a secret needs storage and
  // rotation, and none of it buys anything a public client with PKCE lacks.
  // Stated as a refusal rather than silently downgraded, so a client that
  // genuinely needs one is told rather than left wondering.
  if (parsed.data.token_endpoint_auth_method && parsed.data.token_endpoint_auth_method !== 'none') {
    return badRequest(
      'invalid_client_metadata',
      'This server issues public clients only. Use token_endpoint_auth_method "none" with PKCE.',
    )
  }

  const clientId = generateClientId()
  const admin = createAdminSupabase()

  const { error } = await admin.from('oauth_clients').insert({
    client_id: clientId,
    client_name: parsed.data.client_name ?? 'An assistant',
    redirect_uris: parsed.data.redirect_uris,
  })

  if (error) {
    console.error('oauth/register: could not store client', error.message)
    return NextResponse.json(
      { error: 'server_error', error_description: 'Could not register that client.' },
      { status: 500 },
    )
  }

  return NextResponse.json(
    {
      client_id: clientId,
      client_name: parsed.data.client_name ?? 'An assistant',
      redirect_uris: parsed.data.redirect_uris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      // 0 means "does not expire". There is no secret to expire, and the id
      // alone is inert.
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_secret_expires_at: 0,
    },
    { status: 201 },
  )
}
