/**
 * GET /.well-known/oauth-protected-resource — RFC 9728.
 *
 * The half of discovery that belongs to the *resource* rather than the
 * authorization server: it says "this API is protected, and here is who issues
 * tokens for it". A client reaching `/api/mcp/rpc` without a credential is
 * pointed here by the `WWW-Authenticate` header, follows it, and finds the
 * authorization server — with no configuration typed by a person.
 *
 * Both roles are this same deployment, which is why the two documents point at
 * one origin. They are still two documents because a client asks for them
 * separately and a spec-conformant one will not find the second by guessing.
 */
import { NextResponse } from 'next/server'
import { ALL_MODULES } from '@/modules/settings/logic'

export const dynamic = 'force-dynamic'

export function GET(request: Request) {
  const origin = new URL(request.url).origin

  return NextResponse.json(
    {
      resource: `${origin}/api/mcp/rpc`,
      authorization_servers: [origin],
      scopes_supported: ALL_MODULES,
      bearer_methods_supported: ['header'],
      resource_documentation: 'https://github.com/Ayman306/meridian/blob/main/mcp/README.md',
    },
    { headers: { 'Cache-Control': 'public, max-age=3600' } },
  )
}
