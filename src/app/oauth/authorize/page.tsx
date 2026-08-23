/**
 * /oauth/authorize — the only screen in this flow, and the reason the rest of
 * it is tolerable.
 *
 * Everything else here is machinery: discovery documents, hashed codes, PKCE
 * verification. None of it decides anything. This page is where a person looks
 * at a name they may not recognise, sees exactly which parts of their life it
 * asked for, and says yes or no. Dynamic client registration is safe precisely
 * because it ends here.
 *
 * ## What is validated before anything is rendered
 *
 * The order matters, because it decides whether a failure may be *redirected*
 * or must be *shown*:
 *
 *   1. The client exists, and the redirect URI is one it registered. Until
 *      both hold, the redirect URI is attacker-controlled and sending anything
 *      to it — including an error — is the open-redirect bug itself. So these
 *      two failures render a page instead.
 *   2. Everything after that (response type, PKCE) redirects the error back to
 *      the client, which is what the RFC asks for and what lets a client show
 *      a useful message rather than hanging.
 *
 * ## Sensitive modules arrive unticked
 *
 * A client may ask for `health` or `documents`. Asking is not receiving: they
 * render unticked, with the consequence spelled out, and a person has to
 * deliberately tick them. Granting one means that data travels to whatever
 * model is on the other end, which is a decision worth making awake.
 */
import { redirect } from 'next/navigation'
import { createAdminSupabase, requireUser } from '@/lib/supabase/server'
import { errorRedirect, parseScope, redirectIsRegistered } from '@/lib/oauth'
import { SENSITIVE_TOKEN_MODULES } from '@/mcp/registry'
import { ConsentScreen } from '@/modules/settings/components/ConsentScreen'
import type { ModuleName } from '@/modules/settings/types'

export const dynamic = 'force-dynamic'

interface Params {
  client_id?: string
  redirect_uri?: string
  response_type?: string
  code_challenge?: string
  code_challenge_method?: string
  scope?: string
  state?: string
}

export default async function Authorize({
  searchParams,
}: {
  searchParams: Promise<Params>
}) {
  const params = await searchParams
  const {
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: responseType,
    code_challenge: challenge,
    code_challenge_method: method,
    scope,
    state,
  } = params

  if (!clientId || !redirectUri) {
    return <Refused reason="That request is missing a client or a redirect address." />
  }

  // The service role, for the same reason the token exchange uses it: to answer
  // "who is this client" before anything is decided. It reads one row and
  // returns no couple data.
  const admin = createAdminSupabase()
  const { data: client } = await admin
    .from('oauth_clients')
    .select('client_id, client_name, redirect_uris')
    .eq('client_id', clientId)
    .maybeSingle()

  if (!client) {
    return <Refused reason="That application is not registered with Meridian." />
  }

  // Exact match, and the last point at which a failure may not be redirected.
  if (!redirectIsRegistered(client.redirect_uris, redirectUri)) {
    return (
      <Refused reason="That application asked to be sent somewhere it has not registered. Nothing was shared." />
    )
  }

  // From here the redirect URI is trusted, so refusals go back to the client.
  if (responseType !== 'code') {
    redirect(
      errorRedirect(redirectUri, 'unsupported_response_type', state ?? null, 'Only "code" is supported.'),
    )
  }
  if (!challenge || method !== 'S256') {
    redirect(
      errorRedirect(
        redirectUri,
        'invalid_request',
        state ?? null,
        'A PKCE code_challenge with code_challenge_method=S256 is required.',
      ),
    )
  }

  // Sign-in comes after validation so a person is never asked to authenticate
  // for a request that was never going to work. `next` carries the whole
  // authorization request, so approving lands them back here rather than on a
  // dashboard with the connection silently abandoned.
  const user = await requireUser()
  if (!user) {
    const back = new URLSearchParams(params as Record<string, string>)
    redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${back.toString()}`)}`)
  }

  const asked = parseScope(scope ?? null)
  const sensitive = asked.filter((m): m is ModuleName => SENSITIVE_TOKEN_MODULES.includes(m))
  const ordinary = asked.filter((m) => !SENSITIVE_TOKEN_MODULES.includes(m))

  return (
    <ConsentScreen
      clientName={client.client_name}
      clientId={client.client_id}
      redirectUri={redirectUri}
      codeChallenge={challenge!}
      state={state ?? null}
      ordinary={ordinary}
      sensitive={sensitive}
    />
  )
}

/**
 * A dead end, on purpose.
 *
 * These two cases mean the redirect address cannot be trusted, so there is
 * nowhere safe to send the person back to. Saying so plainly beats a redirect
 * that would be the vulnerability.
 */
function Refused({ reason }: { reason: string }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-3 text-center">
        <h1 className="text-xl font-semibold">Connection refused</h1>
        <p className="text-sm text-muted-foreground">{reason}</p>
        <a className="text-sm underline underline-offset-4" href="/">
          Back to Meridian
        </a>
      </div>
    </main>
  )
}
