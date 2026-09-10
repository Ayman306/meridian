/**
 * Which assistants can reach this account, and one button to stop them.
 *
 * This panel used to mint personal access tokens: pick a name, tick some
 * modules, copy a `mrd_…` string you would never see again, paste it into a
 * config file. That whole flow is gone. Supabase Auth is the OAuth server now,
 * so connecting is done *from the assistant* — it sends you here to approve —
 * and there is nothing for a person to copy, paste or keep safe.
 *
 * What is left is the half that was always the point: seeing what is connected,
 * and being able to end it.
 */
'use client'

import { useState } from 'react'
import { Plug, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { EmptyState, SkeletonList } from '@/components/common/states'
import { SENSITIVE_TOKEN_MODULES } from '@/mcp/registry'
import { MODULE_LABELS } from '../logic'
import { useGrants, useRevokeGrant } from '../hooks'
import type { ModuleName } from '../types'

export function AssistantsPanel() {
  const grants = useGrants()
  const revoke = useRevokeGrant()
  const [revoking, setRevoking] = useState<string | null>(null)

  const target = (grants.data ?? []).find((g) => g.id === revoking)

  return (
    <>
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">Connected assistants</h2>
          <p className="text-xs text-muted-foreground">
            Apps you have approved to read and change your plans, as you. Connect one from the
            assistant itself — it will send you here to approve. Nothing to copy or paste.
          </p>
        </div>

        {grants.isLoading ? (
          <SkeletonList rows={2} />
        ) : (grants.data ?? []).length === 0 ? (
          <EmptyState
            title="Nothing connected"
            description="When an assistant asks for access, you will be shown exactly what it wants before anything is shared."
            subtle
          />
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {(grants.data ?? []).map((grant) => {
              const modules = (grant.modules ?? []) as ModuleName[]
              const sensitive = modules.filter((m) => SENSITIVE_TOKEN_MODULES.includes(m))

              return (
                <li key={grant.id} className="flex items-start gap-3 px-3 py-2.5 text-sm">
                  <Plug className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    {/* The client's own name for itself, rendered as text. */}
                    <p className="truncate">{grant.client_name ?? 'An assistant'}</p>
                    <p className="text-xs text-muted-foreground">
                      {modules.length === 0
                        ? 'nothing shared'
                        : modules.map((m) => MODULE_LABELS[m]).join(', ')}
                      {' · '}
                      {grant.last_used_at
                        ? `last used ${grant.last_used_at.slice(0, 10)}`
                        : 'never used'}
                    </p>
                    {/* Said again here, away from the moment of approval. The
                        decision that matters is easy to make quickly and worth
                        being reminded of later. */}
                    {sensitive.length > 0 && (
                      <p className="mt-1 text-xs text-accent">
                        Can read your {sensitive.map((m) => MODULE_LABELS[m]).join(' and ')}.
                      </p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Disconnect ${grant.client_name ?? 'this assistant'}`}
                    onClick={() => setRevoking(grant.id)}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={revoking !== null}
        title={`Disconnect ${target?.client_name ?? 'this assistant'}?`}
        description="It loses access on its very next request. You can approve it again any time, and it will ask."
        confirmLabel="Disconnect"
        destructive
        onCancel={() => setRevoking(null)}
        onConfirm={() => {
          if (!revoking) return
          revoke.mutate(revoking, { onSuccess: () => setRevoking(null) })
        }}
      />
    </>
  )
}
