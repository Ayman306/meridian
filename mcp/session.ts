/**
 * Turning a personal access token into something that can query.
 *
 * The token on disk is long-lived and does nothing by itself. Every so often it
 * is exchanged at `/api/mcp/token` for a ten-minute user JWT, and that JWT is
 * what PostgREST sees. So the credential sitting in a config file is not a
 * database credential — it is a claim on one, revocable from Settings, and
 * useless the moment its row is revoked.
 *
 * The exchange is cached until shortly before expiry. A stdio server can sit
 * idle for hours between questions, so this refreshes lazily on the next call
 * rather than on a timer that would keep the process awake for nothing.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createUserClient, resolveCoupleId, type McpContext } from '../src/mcp/context'
import type { ModuleName } from '../src/modules/settings/types'

/** Re-exchange this long before expiry, so a slow call cannot straddle it. */
const REFRESH_MARGIN_MS = 60_000

interface Exchanged {
  accessToken: string
  expiresAt: number
  userId: string
  modules: ModuleName[]
  supabaseUrl: string
  supabaseAnonKey: string
}

let cached: Exchanged | null = null

/**
 * Where the token comes from.
 *
 * The environment first, because that is how an MCP client passes secrets and
 * it keeps the token out of the repo. The file is the fallback for running the
 * server by hand without exporting anything.
 */
function readToken(): string {
  const fromEnv = process.env.MERIDIAN_TOKEN?.trim()
  if (fromEnv) return fromEnv

  const path = join(homedir(), '.meridian', 'token')
  try {
    const fromFile = readFileSync(path, 'utf8').trim()
    if (fromFile) return fromFile
  } catch {
    // Falls through to the error below, which explains both options at once.
  }

  throw new Error(
    `No Meridian token. Create one in Settings → Connected assistants, then either set MERIDIAN_TOKEN or write it to ${path}.`,
  )
}

function readBaseUrl(): string {
  const url = process.env.MERIDIAN_URL?.trim()
  if (!url) throw new Error('Set MERIDIAN_URL to your deployed Meridian URL.')
  return url.replace(/\/+$/, '')
}

async function exchange(): Promise<Exchanged> {
  const response = await fetch(`${readBaseUrl()}/api/mcp/token`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${readToken()}` },
  })

  if (response.status === 401) {
    throw new Error(
      'Meridian rejected that token. It may have been revoked or expired — create a new one in Settings → Connected assistants.',
    )
  }
  if (!response.ok) {
    throw new Error(`Meridian returned ${response.status} exchanging the token.`)
  }

  const body = (await response.json()) as {
    access_token: string
    expires_in: number
    user_id: string
    modules: string[]
    supabase_url: string
    supabase_anon_key: string
  }

  return {
    accessToken: body.access_token,
    expiresAt: Date.now() + body.expires_in * 1000,
    userId: body.user_id,
    modules: body.modules as ModuleName[],
    supabaseUrl: body.supabase_url,
    supabaseAnonKey: body.supabase_anon_key,
  }
}

/** A valid exchange, from cache when one is still comfortably fresh. */
export async function currentSession(): Promise<Exchanged> {
  if (cached && cached.expiresAt - Date.now() > REFRESH_MARGIN_MS) return cached
  cached = await exchange()
  return cached
}

/**
 * The context one tool call runs in.
 *
 * The couple lookup is per call rather than cached with the session: pairing
 * can happen while this process is running, and a server that decided at
 * startup that you were solo would keep saying so until it was restarted.
 */
export async function contextForCall(): Promise<McpContext> {
  const session = await currentSession()
  const supabase = createUserClient(session.supabaseUrl, session.supabaseAnonKey, session.accessToken)
  return {
    supabase,
    userId: session.userId,
    coupleId: await resolveCoupleId(supabase),
    modules: session.modules,
  }
}
