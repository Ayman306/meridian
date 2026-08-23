/**
 * "Do you want this thing to see your trips?"
 *
 * The screen an OAuth flow exists for. Everything else in the authorization
 * server is plumbing that leads here, and the plumbing is only safe because
 * this step cannot be skipped or automated.
 *
 * Three deliberate choices:
 *
 *   1. **The client's name is rendered as text.** It is a string the client
 *      chose about itself, uploaded by anyone who can reach the registration
 *      endpoint. React escapes it, and it is never given a link.
 *   2. **Ordinary modules are ticked; sensitive ones are not.** A person who
 *      skims and presses the button gets a working, useful grant and no health
 *      data. Getting health data requires reading a sentence and making a
 *      decision — which is the whole difference.
 *   3. **Refusing is a button, not the back arrow.** Declining redirects to
 *      the client with `access_denied`, so the thing that asked finds out and
 *      can say so, instead of hanging on a window a person closed.
 */
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { MODULE_LABELS } from '../logic'
import type { ModuleName } from '../types'

export function ConsentScreen({
  clientName,
  clientId,
  redirectUri,
  codeChallenge,
  state,
  ordinary,
  sensitive,
}: {
  clientName: string
  clientId: string
  redirectUri: string
  codeChallenge: string
  state: string | null
  ordinary: ModuleName[]
  sensitive: ModuleName[]
}) {
  const [granted, setGranted] = useState<ModuleName[]>(ordinary)

  const toggle = (module: ModuleName) =>
    setGranted((current) =>
      current.includes(module) ? current.filter((m) => m !== module) : [...current, module],
    )

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-10">
      <Card className="w-full max-w-md space-y-5 p-6">
        <div className="space-y-2">
          <h1 className="text-lg font-semibold">
            {/* Text, never markup, never a link. */}
            {clientName} wants to connect to Meridian
          </h1>
          <p className="text-sm text-muted-foreground">
            It will be able to read and change what you tick below, as you. It can never reach
            your partner&rsquo;s private data, and everything it does is still subject to the same
            rules as the app.
          </p>
        </div>

        <form method="post" action="/api/oauth/approve" className="space-y-5">
          <input type="hidden" name="client_id" value={clientId} />
          <input type="hidden" name="redirect_uri" value={redirectUri} />
          <input type="hidden" name="code_challenge" value={codeChallenge} />
          {state !== null && <input type="hidden" name="state" value={state} />}
          {granted.map((module) => (
            <input key={module} type="hidden" name="modules" value={module} />
          ))}

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

          {sensitive.length > 0 && (
            <fieldset className="space-y-2 rounded-md border border-border p-3">
              <legend className="px-1 text-xs font-medium text-muted-foreground">
                Asked for, and off unless you turn it on
              </legend>
              <p className="text-xs text-muted-foreground">
                Turning one of these on means that data leaves Meridian and reaches whatever
                assistant is on the other end. Nothing here is needed to plan a trip.
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
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="submit" name="decision" value="deny" variant="ghost">
              Don&rsquo;t connect
            </Button>
            <Button type="submit" name="decision" value="allow" disabled={granted.length === 0}>
              Connect
            </Button>
          </div>

          {granted.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Nothing is ticked, so there is nothing to connect to.
            </p>
          )}
        </form>

        <p className="border-t border-border pt-3 text-xs text-muted-foreground">
          You can revoke this at any time in Settings, under Connected assistants. Revoking takes
          effect on the next request it makes.
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
