/**
 * GET /.well-known/oauth-authorization-server — RFC 8414 discovery.
 *
 * Served from `/api/oauth/metadata` and rewritten to the well-known path in
 * `next.config.ts`, because the App Router will not route a directory whose
 * name begins with a dot.
 *
 * What a client learns here is only where to go next. It is unauthenticated on
 * purpose — discovery has to work before anybody has a credential, and every
 * field below is a URL that is already public.
 *
 * The advertised set is deliberately narrow. `response_types_supported` is
 * `code` and nothing else, so there is no implicit grant to negotiate down to;
 * `code_challenge_methods_supported` is `S256` and nothing else, so `plain`
 * cannot be selected; `token_endpoint_auth_methods_supported` is `none`,
 * because every client here is public and there are no secrets to present.
 */
import { NextResponse } from 'next/server'
import { ALL_MODULES } from '@/modules/settings/logic'

export const dynamic = 'force-dynamic'

export function GET(request: Request) {
  const origin = new URL(request.url).origin

  return NextResponse.json(
    {
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/api/oauth/token`,
      registration_endpoint: `${origin}/api/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ALL_MODULES,
      service_documentation: 'https://github.com/Ayman306/meridian/blob/main/mcp/README.md',
    },
    // Discovery is stable and fetched on every connection attempt. An hour of
    // caching costs nothing and keeps a cold start off the critical path.
    { headers: { 'Cache-Control': 'public, max-age=3600' } },
  )
}
