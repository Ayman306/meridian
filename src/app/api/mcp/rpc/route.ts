/**
 * POST /api/mcp/rpc — the MCP server over HTTP, so it works from a phone.
 *
 * The stdio server needs a laptop running a process. This is the same registry
 * reached over the wire, which is what the Claude mobile app and any hosted
 * client can talk to.
 *
 * ## Two ways to authenticate, and one thing they both become
 *
 * A personal access token in an `Authorization` header is the simple path, and
 * the one to prefer when a client can be configured with one.
 *
 * For clients that can only do OAuth — the hosted surfaces, which cannot be
 * handed a bearer header by a person — there is now an authorization server
 * alongside this endpoint (0030, `/api/oauth/*`). This route did not change to
 * accommodate it, and that is the design: an OAuth grant *is* a row in
 * `access_tokens`, so `authenticate()` below cannot tell the two apart and does
 * not need to. One credential shape, one expiry check, one revoke.
 *
 * The 401 below advertises the authorization server via RFC 9728, which is how
 * a client with no credential finds its way to the consent screen.
 *
 * ## Why the token is verified on every call
 *
 * There is no session. Each request re-checks the token's row, so revoking one
 * in Settings takes effect on the next call rather than whenever some cache
 * happened to expire. That costs one indexed lookup and is the whole reason
 * revocation means anything.
 *
 * ## Shape
 *
 * JSON-RPC 2.0 over a single POST, which is the Streamable HTTP transport's
 * required half. The optional SSE half is not implemented: nothing in this
 * server pushes, every tool is request/response, and an endpoint that opens a
 * stream it never writes to is a connection held for nothing.
 */
import { NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase/server'
import { bearerToken, hashToken, isPlausibleToken, isTokenUsable } from '@/lib/tokens'
import { mintUserJwt } from '@/lib/mcp-jwt'
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

/**
 * Who is calling, or null.
 *
 * Identical in substance to `/api/mcp/token` — the same single sanctioned use
 * of the service role, to answer "which user is this credential" before
 * anything is touched. It returns a context bound to a minted user JWT and
 * never data.
 */
async function authenticate(request: Request): Promise<McpContext | null> {
  const raw = bearerToken(request.headers.get('authorization'))
  if (!isPlausibleToken(raw)) return null

  const secret = process.env.SUPABASE_JWT_SECRET
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!secret || !supabaseUrl || !anonKey) {
    throw new Error('not-configured')
  }

  const admin = createAdminSupabase()
  const { data: row, error } = await admin
    .from('access_tokens')
    .select('id, user_id, modules, expires_at, revoked_at')
    .eq('token_hash', await hashToken(raw!))
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!row || !isTokenUsable(row)) return null

  await admin
    .from('access_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', row.id)

  const minted = await mintUserJwt(row.user_id, secret, supabaseUrl)
  const supabase = createUserClient(supabaseUrl, anonKey, minted.token)

  return {
    supabase,
    userId: row.user_id,
    coupleId: await resolveCoupleId(supabase),
    modules: row.modules as ModuleName[],
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

  // `initialize` is answered before authentication so a client can discover
  // the server and be told to authenticate, rather than getting an opaque 401
  // with nothing to act on. It reveals only the protocol version and a name.
  if (method === 'initialize') {
    return result(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: 'meridian', version: '1.0.0' },
    })
  }

  // Notifications carry no id and expect no reply.
  if (method?.startsWith('notifications/')) {
    return new NextResponse(null, { status: 202 })
  }

  let ctx: McpContext | null
  try {
    ctx = await authenticate(request)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (message === 'not-configured') {
      return failure(id, -32603, 'This deployment is not configured for MCP.', 503)
    }
    console.error('mcp/rpc: authentication failed', message)
    return failure(id, -32603, 'Could not verify that token.', 500)
  }

  if (!ctx) {
    // A 401 that tells an OAuth-capable client where to go.
    //
    // `resource_metadata` is RFC 9728, and it is the hinge of the whole
    // connector flow: a client with no credential fetches that document,
    // finds the authorization server, registers itself, and sends its user to
    // the consent screen — with nothing typed by a person. Without this
    // parameter the same client sees an opaque 401 and stops.
    //
    // A bearer token still works and is still the simpler path. This header
    // costs nothing to a client that has one.
    const origin = new URL(request.url).origin
    return NextResponse.json(
      { jsonrpc: '2.0', id: id ?? null, error: { code: -32001, message: 'That token is not valid.' } },
      {
        status: 401,
        headers: {
          'WWW-Authenticate':
            `Bearer realm="meridian", resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
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
    // Re-checked here and not only in the listing, exactly as the stdio server
    // does: a client that cached an older list, or invented a name, must not
    // get through on that basis.
    const tool = available.find((t) => t.name === name)
    if (!tool) {
      return result(id, {
        isError: true,
        content: [{ type: 'text', text: `No tool called "${name}" is available to this token.` }],
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
