import type { NextConfig } from 'next'

const config: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,

  /**
   * The two OAuth discovery documents have to live at `/.well-known/…`, and the
   * App Router will not route a directory whose name begins with a dot — it
   * treats it as private. So they are ordinary handlers under `/api/oauth` and
   * are rewritten into place here.
   *
   * A rewrite rather than a redirect: a client fetching a well-known document
   * expects the document, and a 307 to somewhere else is a hop some of them do
   * not take.
   */
  /**
   * One rewrite, for one document.
   *
   * `/.well-known/oauth-protected-resource` has to live at the root of this
   * origin and the App Router will not route a directory whose name begins
   * with a dot, so it is an ordinary handler under `/api/oauth` mapped into
   * place here.
   *
   * The `oauth-authorization-server` document is deliberately absent: Supabase
   * Auth serves that one now, and a stale copy of it here would be a client
   * being told the wrong place to get tokens.
   */
  async rewrites() {
    return [
      {
        source: '/.well-known/oauth-protected-resource',
        destination: '/api/oauth/protected-resource',
      },
      // RFC 9728 lets a client append the resource path to the well-known
      // path. Both spellings land on the same document rather than one of
      // them 404ing for no reason a person can see.
      {
        source: '/.well-known/oauth-protected-resource/api/mcp/rpc',
        destination: '/api/oauth/protected-resource',
      },
    ]
  },
}

export default config
