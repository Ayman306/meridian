/**
 * GET /.well-known/oauth-protected-resource — RFC 9728.
 *
 * The one discovery document this app still serves, and the only reason it
 * does: it is the signpost from *this* origin to Supabase's authorization
 * server, and nobody else can put it here.
 *
 * Everything else — the authorization endpoint, the token endpoint, JWKS,
 * dynamic client registration, the `oauth-authorization-server` document
 * itself — is served by Supabase Auth at `<project>.supabase.co/auth/v1`.
 * 0032 deleted our copies of all of them.
 *
 * The flow this enables, with nothing typed by a person:
 *
 *   1. A client POSTs to `/api/mcp/rpc` with no credential and gets a 401
 *      naming this document.
 *   2. It fetches this, and learns that tokens for `/api/mcp/rpc` come from
 *      the Supabase project named below.
 *   3. It fetches Supabase's own discovery document, registers itself, and
 *      sends its person to the consent screen.
 *
 * Served from `/api/oauth/protected-resource` and rewritten into place in
 * `next.config.ts`, because the App Router will not route a directory whose
 * name begins with a dot.
 */
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export function GET(request: Request) {
  const origin = new URL(request.url).origin
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL

  if (!supabaseUrl) {
    return NextResponse.json(
      { error: 'This deployment is not configured for Supabase.' },
      { status: 503 },
    )
  }

  return NextResponse.json(
    {
      resource: `${origin}/api/mcp/rpc`,
      // Supabase Auth, not us. This is the whole content of the document.
      authorization_servers: [`${supabaseUrl}/auth/v1`],
      bearer_methods_supported: ['header'],
      resource_documentation: 'https://github.com/Ayman306/meridian/blob/main/mcp/README.md',
    },
    // Stable, and fetched on every connection attempt.
    { headers: { 'Cache-Control': 'public, max-age=3600' } },
  )
}
