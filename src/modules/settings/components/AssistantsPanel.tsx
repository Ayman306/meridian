/**
 * Connected assistants — minting and revoking personal access tokens.
 *
 * The screen is built around one awkward fact: the token is shown exactly once.
 * It is generated in this component, only its hash is sent to Postgres, and the
 * column holding that hash is revoked from `authenticated` at the database
 * level. There is no "show it again" because there is nothing left to show.
 *
 * So the reveal is deliberately hard to miss and hard to dismiss by accident,
 * and the list underneath shows `last_used_at` — the thing you actually want
 * when wondering whether a token you forgot about is still being used.
 */
'use client'

import { useState } from 'react'
import { Copy, Check, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { EmptyState, ErrorState, SkeletonList } from '@/components/common/states'
import {
  DEFAULT_TOKEN_MODULES,
  GRANTABLE_MODULES,
  SENSITIVE_TOKEN_MODULES,
} from '@/mcp/registry'
import { cn } from '@/lib/utils'
import { MODULE_LABELS } from '../logic'
import { useAccessTokens, useCreateAccessToken, useRevokeAccessToken } from '../hooks'
import type { ModuleName } from '../types'

export function AssistantsPanel() {
  const tokens = useAccessTokens()
  const create = useCreateAccessToken()
  const revoke = useRevokeAccessToken()

  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [modules, setModules] = useState<ModuleName[]>(DEFAULT_TOKEN_MODULES)
  const [revealed, setRevealed] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [revoking, setRevoking] = useState<string | null>(null)

  const toggle = (module: ModuleName) => {
    setModules((current) =>
      current.includes(module) ? current.filter((m) => m !== module) : [...current, module],
    )
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-2 p-5">
        <h2 className="text-sm font-medium">What these are</h2>
        <p className="text-sm text-muted-foreground">
          A token lets an AI assistant read and add to your plans from outside the app. It acts as
          you, sees only what you can see, and can be revoked here at any time.
        </p>
        <p className="text-sm text-muted-foreground">
          A generated day-plan never goes straight onto an itinerary — it lands in the trip’s tray
          for one of you to accept. Single things you dictate are saved directly.
        </p>
        <p className="text-sm text-muted-foreground">
          {SENSITIVE_TOKEN_MODULES.map((m) => MODULE_LABELS[m]).join(' and ')} are off unless you
          tick them, and a token can only ever reach your own — never your partner’s, whatever the
          two of you have shared with each other in the app.
        </p>
      </Card>

      {revealed && (
        <Card className="space-y-3 border-accent p-5">
          <h3 className="text-sm font-medium">Copy this now</h3>
          <p className="text-sm text-muted-foreground">
            This is the only time it is shown. It is stored hashed, so it cannot be shown again — if
            you lose it, revoke it and make another.
          </p>
          <code className="block overflow-x-auto rounded-md border border-border bg-muted p-3 font-mono text-xs">
            {revealed}
          </code>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(revealed)
                setCopied(true)
              }}
            >
              {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setRevealed(null)
                setCopied(false)
              }}
            >
              I have saved it
            </Button>
          </div>
        </Card>
      )}

      {adding ? (
        <Card className="space-y-4 p-5">
          <div className="space-y-1">
            <label htmlFor="token-name" className="text-sm">
              What is it for
            </label>
            <Input
              id="token-name"
              value={name}
              placeholder="Claude on my laptop"
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm">What it can reach</legend>
            <div className="flex flex-wrap gap-2">
              {GRANTABLE_MODULES.map((module) => (
                <label
                  key={module}
                  className={cn(
                    'cursor-pointer rounded-md border px-3 py-1.5 text-sm',
                    modules.includes(module) ? 'border-accent bg-accent/10' : 'border-input',
                  )}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={modules.includes(module)}
                    onChange={() => toggle(module)}
                  />
                  {MODULE_LABELS[module]}
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Narrower is better. A token scoped to trips cannot be talked into reading your
              spending, because those tools do not exist for it.
            </p>

            {/* Said at the moment of choosing, not buried in a preamble above.
                Ticking one of these is the one decision here with a consequence
                outside the app. */}
            {modules.some((m) => SENSITIVE_TOKEN_MODULES.includes(m)) && (
              <p className="rounded-md bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
                You have ticked{' '}
                {modules
                  .filter((m) => SENSITIVE_TOKEN_MODULES.includes(m))
                  .map((m) => MODULE_LABELS[m])
                  .join(' and ')}
                . Whatever this token reads there is sent to whichever AI service you connect it to.
                That is yours to decide — this is only saying it plainly.
              </p>
            )}
          </fieldset>

          <div className="flex gap-2">
            <Button
              disabled={!name.trim() || modules.length === 0 || create.isPending}
              onClick={() =>
                create.mutate(
                  { name, modules, expiresInDays: null },
                  {
                    onSuccess: ({ raw }) => {
                      setRevealed(raw)
                      setCopied(false)
                      setAdding(false)
                      setName('')
                      setModules(DEFAULT_TOKEN_MODULES)
                    },
                  },
                )
              }
            >
              {create.isPending ? 'Creating…' : 'Create token'}
            </Button>
            <Button variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
          {create.error ? <ErrorState error={create.error} title="That did not work" /> : null}
        </Card>
      ) : (
        <Button variant="outline" onClick={() => setAdding(true)}>
          <Plus aria-hidden="true" />
          New token
        </Button>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-medium">Active tokens</h3>
        {tokens.isLoading ? (
          <SkeletonList rows={2} />
        ) : tokens.error ? (
          <ErrorState error={tokens.error} title="That did not load" />
        ) : (tokens.data ?? []).length === 0 ? (
          <EmptyState
            title="No tokens"
            description="Nothing is connected to your account."
            subtle
          />
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {(tokens.data ?? []).map((token) => (
              <li key={token.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate">
                    {token.name}
                    {/* An app grant looks the same in this table as a token
                        typed into a config file, because it is the same row.
                        Saying which is which matters anyway: one you can
                        re-create from memory, the other has to be re-approved
                        by whatever asked for it. */}
                    {token.kind === 'oauth' && (
                      <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        approved app
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <code className="font-mono">{token.prefix}…</code>
                    {' · '}
                    {token.modules.length === GRANTABLE_MODULES.length
                      ? 'everything allowed'
                      : `${token.modules.length} module${token.modules.length === 1 ? '' : 's'}`}
                    {' · '}
                    {token.last_used_at
                      ? `last used ${token.last_used_at.slice(0, 10)}`
                      : 'never used'}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Revoke ${token.name}`}
                  onClick={() => setRevoking(token.id)}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={revoking !== null}
        title="Revoke this token?"
        description="Whatever is using it stops working immediately. This cannot be undone — you would need to create a new token and reconnect."
        confirmLabel="Revoke"
        destructive
        onCancel={() => setRevoking(null)}
        onConfirm={() => {
          if (revoking) revoke.mutate(revoking)
          setRevoking(null)
        }}
      />
    </div>
  )
}
