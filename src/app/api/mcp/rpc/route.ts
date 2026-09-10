/**
 * POST /api/mcp/rpc — the MCP server, over HTTP.
 *
 * ## Supabase is the authorization server. We are not.
 *
 * This app used to mint its own Supabase JWTs from `SUPABASE_JWT_SECRET`, and
 * then grew a hand-written OAuth 2.1 server on top: clients, authorization
 * codes, PKCE, refresh rotation, replay detection. All of it is gone (0032).
 * Supabase Auth ships an OAuth 2.1 server with native MCP support, so
 * discovery, dynamic client registration, consent hand-off, token issue and
 * refresh are its job now.
 *
 * The bearer token on a request is therefore **an ordinary Supabase access
 * token, issued by Supabase, signed by Supabase**. Three things follow, and
 * they are the whole reason this was worth doing:
 *
 *   1. **No secret.** Nothing here signs anything. `SUPABASE_JWT_SECRET` — the
 *      key that could mint a session for any user in the project — is not read
 *      by this app any more, and a project on asymmetric signing keys works
 *      identically, which it could not before.
 *   2. **No service role.** The credential the caller presents is already a
 *      user credential, so there is nothing to look up as an admin first. The
 *      key that bypasses RLS is now absent from the MCP path entirely, rather
 *      than present-but-careful.
 *   3. **RLS is untouched.** The token carries a real `sub`, so PostgREST
 *      judges an AI agent by exactly the policies it judges a browser by.
 *
 * ## What is still ours
 *
 * One thing: which *modules* a person approved. OAuth scopes describe identity
 * — `openid`, `email`, `profile` — and have nothing to say about whether an
 * assistant may read a cycle log. That lives in `mcp_grants`, written by the
 * consent screen, and it is why a grant with no health module does not merely
 * refuse health tools: it is never offered them.
 *
 * ## Shape
 *
 * JSON-RPC 2.0 over a single POST — the Streamable HTTP transport's required
 * half. The optional SSE half is not implemented: nothing here pushes, every
 * tool is request/response, and a stream that is never written to is a
 * connection held for nothing.
 */
import { NextResponse } from 'next/server'
import { createUserClient, resolveCoupleId, type McpContext } from '@/mcp/context'
import { toolsFor } from '@/mcp/registry'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { ModuleName } from '@/modules/settings/types'

export const dynamic = 'force-dynamic'

const PROTOCOL_VERSION = '2025-06-18'

interface RpcRequest {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

function result(id: RpcRequest['id'], value: unknown) {
  return NextResponse.json({ jsonrpc: '2.0', id: id ?? null, result: value })
}

function failure(id: RpcRequest['id'], code: number, message: string, status = 200) {
  return NextResponse.json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } }, { status })
}

function bearer(header: string | null): string | null {
  if (!header) return null
  return /^Bearer\s+(\S+)$/i.exec(header.trim())?.[1] ?? null
}

/**
 * Which OAuth client the token was issued to.
 *
 * Read from the payload without verifying the signature, which is safe **only**
 * because `getUser()` has already verified the same token against Supabase
 * before this is called. Reading a claim off an unverified token is how these
 * things go wrong, so the ordering in `authenticate` is not incidental.
 */
function clientIdOf(token: string): string | null {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()
    const claims = JSON.parse(json) as { client_id?: unknown }
    return typeof claims.client_id === 'string' ? claims.client_id : null
  } catch {
    return null
  }
}

type AuthFailure = 'unconfigured' | 'bad-token' | 'no-grant'

/**
 * Who is calling, or why not.
 *
 * The token is validated by handing it to Supabase, which is the only party
 * that can say whether it is real, unexpired and unrevoked. That costs one
 * request and it is the reason revoking access takes effect immediately rather
 * than whenever a cache happens to expire.
 */
async function authenticate(request: Request): Promise<McpContext | AuthFailure> {
  const token = bearer(request.headers.get('authorization'))
  if (!token) return 'bad-token'

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) return 'unconfigured'

  const supabase = createUserClient(url, anonKey, token)

  // Supabase is asked, rather than the signature being checked locally. A
  // locally-valid JWT says nothing about whether the session behind it was
  // revoked thirty seconds ago, and revocation that takes an hour to bite is
  // not revocation.
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) return 'bad-token'

  // A token with no grant row is a client that got through Supabase's
  // authorization without ever reaching our consent screen — or one whose
  // grant the owner has since deleted in Settings. Either way there is no
  // record of anybody agreeing to anything, so it gets nothing.
  const clientId = clientIdOf(token)
  const { data: grant } = await supabase
    .from('mcp_grants')
    .select('id, modules')
    .eq('client_id', clientId ?? '')
    .maybeSingle()

  if (!grant) return 'no-grant'

  // Best effort. A failed timestamp must not deny a valid call, but a grant
  // that never records a use makes a stolen one invisible.
  void supabase
    .from('mcp_grants')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', grant.id)
    .then(({ error: touchError }) => {
      if (touchError) console.warn('mcp/rpc: could not record grant use', touchError.message)
    })

  return {
    supabase,
    userId: data.user.id,
    coupleId: await resolveCoupleId(supabase),
    modules: (grant.modules ?? []) as ModuleName[],
  }
}

export async function POST(request: Request) {
  let body: RpcRequest
  try {
    body = (await request.json()) as RpcRequest
  } catch {
    return failure(null, -32700, 'That was not JSON.')
  }

  const { id, method } = body

  // Answered before authentication so a client can discover the server and be
  // told to authenticate, rather than getting an opaque 401 with nothing to act
  // on. It reveals only a protocol version and a name.
  if (method === 'initialize') {
    return result(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: 'meridian', version: '2.0.0' },
    })
  }

  // Notifications carry no id and expect no reply.
  if (method?.startsWith('notifications/')) {
    return new NextResponse(null, { status: 202 })
  }

  const ctx = await authenticate(request)

  if (ctx === 'unconfigured') {
    return failure(id, -32603, 'This deployment is not configured for Supabase.', 503)
  }
  if (ctx === 'bad-token' || ctx === 'no-grant') {
    // The 401 points at Supabase's own discovery document, which is what turns
    // a bare refusal into a connection: an OAuth-capable client follows it,
    // registers itself, and sends its person to the consent screen with
    // nothing typed by hand. Without this header a client sees a dead end.
    const authServer = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`
    const message =
      ctx === 'no-grant'
        ? 'That app has no approved grant on this account. Approve it again in Meridian.'
        : 'That token is not valid.'

    return NextResponse.json(
      { jsonrpc: '2.0', id: id ?? null, error: { code: -32001, message } },
      {
        status: 401,
        headers: {
          'WWW-Authenticate': `Bearer realm="meridian", resource_metadata="${new URL(request.url).origin}/.well-known/oauth-protected-resource", authorization_uri="${authServer}"`,
        },
      },
    )
  }

  const available = toolsFor(ctx.modules)

  if (method === 'tools/list') {
    return result(id, {
      tools: available.map((tool) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: zodToJsonSchema(tool.inputSchema, { $refStrategy: 'none' }),
        annotations: { readOnlyHint: tool.readOnly },
      })),
    })
  }

  if (method === 'tools/call') {
    const name = String(body.params?.name ?? '')
    // Re-checked here and not only in the listing. The two are separate
    // requests, and a client that cached an older list — or simply invented a
    // name — must not get through on that basis.
    const tool = available.find((t) => t.name === name)
    if (!tool) {
      return result(id, {
        isError: true,
        content: [{ type: 'text', text: `No tool called "${name}" is available to this grant.` }],
      })
    }

    try {
      const input = tool.inputSchema.parse(body.params?.arguments ?? {})
      const text = await tool.handler(ctx, input)
      return result(id, { content: [{ type: 'text', text }] })
    } catch (e) {
      // A tool error rather than a protocol error: the model can read what went
      // wrong and try something else, usually a missing id it can look up.
      const message = e instanceof Error ? e.message : String(e)
      return result(id, { isError: true, content: [{ type: 'text', text: message }] })
    }
  }

  return failure(id, -32601, `Unknown method "${method}".`)
}

/**
 * The Streamable HTTP transport allows a GET that opens an SSE stream for
 * server-initiated messages. This server never initiates one, so the honest
 * answer is that the method is not allowed rather than a stream that stays
 * silent forever and holds a connection open.
 */
export function GET() {
  return NextResponse.json(
    { error: 'This endpoint speaks JSON-RPC over POST. There is no event stream.' },
    { status: 405, headers: { Allow: 'POST' } },
  )
}
