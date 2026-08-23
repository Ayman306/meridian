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
  async rewrites() {
    return [
      {
        source: '/.well-known/oauth-authorization-server',
        destination: '/api/oauth/metadata',
      },
      {
        source: '/.well-known/oauth-protected-resource',
        destination: '/api/oauth/protected-resource',
      },
      // Some clients append the resource path to the well-known path, per
      // RFC 9728's path-insertion rule. Both spellings land on the same
      // document rather than one of them 404ing for no reason a user can see.
      {
        source: '/.well-known/oauth-protected-resource/api/mcp/rpc',
        destination: '/api/oauth/protected-resource',
      },
      {
        source: '/.well-known/oauth-authorization-server/api/mcp/rpc',
        destination: '/api/oauth/metadata',
      },
    ]
  },
}

export default config
