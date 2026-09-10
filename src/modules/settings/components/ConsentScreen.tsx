/**
 * "Do you want this thing to see your trips?"
 *
 * The only screen in the OAuth flow that is ours, and the only step that cannot
 * be automated. Supabase validated the client and its redirect URI before we
 * were reached, and it will issue the tokens after. What it cannot decide is
 * which *modules* an assistant may touch — its scopes describe identity, not
 * whether something may read a cycle log — so that decision is made here and
 * written to `mcp_grants`.
 *
 * Three deliberate choices, carried over from the hand-written flow because
 * they were the parts worth keeping:
 *
 *   1. **The client's name is rendered as text.** It is a string the client
 *      chose about itself. React escapes it, and it is never given a link.
 *   2. **Ordinary modules are ticked; health and documents are not.** Somebody
 *      who skims and presses the button gets a working, useful assistant and no
 *      health data. Getting health data requires reading a sentence and making
 *      a decision, which is the whole difference.
 *   3. **Refusing is a button.** Declining tells the client, so it can say so,
 *      rather than hanging on a window somebody closed.
 *
 * The grant is written *before* the approval is handed back. If the write
 * fails, no approval is granted — better a connection that visibly did not
 * happen than a token that works with a scope nobody recorded.
 */
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ErrorState, SkeletonList } from '@/components/common/states'
import { AppError } from '@/lib/errors'
import { DEFAULT_TOKEN_MODULES, SENSITIVE_TOKEN_MODULES } from '@/mcp/registry'
import { useSaveGrant } from '../hooks'
import { MODULE_LABELS } from '../logic'
import type { ModuleName } from '../types'

interface ClientInfo {
  id: string
  name: string
}

export function ConsentScreen({ authorizationId }: { authorizationId: string }) {
  const router = useRouter()
  const save = useSaveGrant()

  const [client, setClient] = useState<ClientInfo | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [pending, setPending] = useState(false)
  const [granted, setGranted] = useState<ModuleName[]>([...DEFAULT_TOKEN_MODULES])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      const { data, error: detailsError } = await supabase.auth.oauth.getAuthorizationDetails(
        authorizationId,
      )
      if (cancelled) return

      if (detailsError || !data) {
        setError(detailsError ?? new AppError('That authorisation request is not valid.'))
        return
      }

      // Two shapes come back. `authorization_id` means Supabase wants consent;
      // `redirect_url` means this person already consented *at Supabase* and it
      // would send them straight on. We render our screen either way, because
      // Supabase's consent covers identity scopes and says nothing about which
      // modules an assistant may read — and that is the decision this page is
      // for. The approve step below handles both.
      if ('authorization_id' in data) {
        setClient({ id: data.client.id, name: data.client.name })
      } else {
        setClient({ id: 'unknown', name: 'This assistant' })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [authorizationId])

  const toggle = (module: ModuleName) =>
    setGranted((current) =>
      current.includes(module) ? current.filter((m) => m !== module) : [...current, module],
    )

  const decide = async (allow: boolean) => {
    setPending(true)
    setError(null)

    try {
      if (!allow) {
        const { data, error: denyError } = await supabase.auth.oauth.denyAuthorization(
          authorizationId,
          { skipBrowserRedirect: true },
        )
        if (denyError) throw denyError
        if (data?.redirect_url) window.location.href = data.redirect_url
        else router.push('/settings')
        return
      }

      // Approve at Supabase first so we learn the real client id it issued the
      // grant to — that id is what arrives in every token's `client_id` claim,
      // and it is the only thing `/api/mcp/rpc` can match a grant on.
      const { data, error: approveError } = await supabase.auth.oauth.approveAuthorization(
        authorizationId,
        { skipBrowserRedirect: true },
      )
      if (approveError) throw approveError

      await save.mutateAsync({
        clientId: client?.id ?? 'unknown',
        clientName: client?.name ?? null,
        modules: granted,
      })

      if (data?.redirect_url) window.location.href = data.redirect_url
      else router.push('/settings')
    } catch (e) {
      setError(e)
      setPending(false)
    }
  }

  if (error) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm">
          <ErrorState error={error} />
        </div>
      </main>
    )
  }

  if (!client) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center px-6">
        <div className="w-full max-w-md">
          <SkeletonList rows={3} />
        </div>
      </main>
    )
  }

  const ordinary = DEFAULT_TOKEN_MODULES
  const sensitive = SENSITIVE_TOKEN_MODULES

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-10">
      <Card className="w-full max-w-md space-y-5 p-6">
        <div className="space-y-2">
          <h1 className="text-lg font-semibold">{client.name} wants to connect to Meridian</h1>
          <p className="text-sm text-muted-foreground">
            It will be able to read and change what you tick below, as you. It can never reach
            your partner&rsquo;s private data, and everything it does is subject to the same rules
            as the app.
          </p>
        </div>

        <fieldset className="space-y-2">
          <legend className="sr-only">What to share</legend>
          {ordinary.map((module) => (
            <Row
              key={module}
              module={module}
              checked={granted.includes(module)}
              onToggle={() => toggle(module)}
            />
          ))}
        </fieldset>

        <fieldset className="space-y-2 rounded-md border border-border p-3">
          <legend className="px-1 text-xs font-medium text-muted-foreground">
            Off unless you turn it on
          </legend>
          <p className="text-xs text-muted-foreground">
            Turning one of these on means that data leaves Meridian and reaches whatever assistant
            is on the other end. Nothing here is needed to plan a trip.
          </p>
          {sensitive.map((module) => (
            <Row
              key={module}
              module={module}
              checked={granted.includes(module)}
              onToggle={() => toggle(module)}
            />
          ))}
        </fieldset>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" disabled={pending} onClick={() => void decide(false)}>
            Don&rsquo;t connect
          </Button>
          <Button disabled={pending || granted.length === 0} onClick={() => void decide(true)}>
            {pending ? 'Connecting…' : 'Connect'}
          </Button>
        </div>

        {granted.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Nothing is ticked, so there is nothing to connect to.
          </p>
        )}

        <p className="border-t border-border pt-3 text-xs text-muted-foreground">
          You can disconnect this at any time in Settings. It loses access on its next request.
        </p>
      </Card>
    </main>
  )
}

function Row({
  module,
  checked,
  onToggle,
}: {
  module: ModuleName
  checked: boolean
  onToggle: () => void
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-md px-1 py-1.5 text-sm hover:bg-secondary/60">
      <input
        type="checkbox"
        className="size-4 accent-primary"
        checked={checked}
        onChange={onToggle}
      />
      <span>{MODULE_LABELS[module]}</span>
    </label>
  )
}
