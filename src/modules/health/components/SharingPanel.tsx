/**
 * What is shared, and how to stop sharing it. Spec 12.2.
 *
 * Three of the spec's non-negotiables live in this component's *behaviour*
 * rather than in a comment somewhere:
 *
 * - **Everything is off until it is turned on.** There is no default grant and
 *   no "share all" button.
 * - **Revoking is one click, immediate, with no confirmation friction.** A
 *   dialog asking "are you sure?" would be pressure applied at exactly the
 *   moment somebody has decided they want their privacy back.
 * - **No notification pressure on the owner.** Revoking tells nobody. There is
 *   no copy here saying what the other person will see or think.
 *
 * The list at the top states exactly what is currently shared, in words,
 * because a row of toggles is a control surface and not an answer.
 */
'use client'

import { Lock, ShieldOff } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/common/states'
import { cn } from '@/lib/utils'
import { useCouple } from '@/providers/CoupleProvider'
import { useAuth } from '@/providers/AuthProvider'
import {
  SCOPES,
  SCOPE_DESCRIPTIONS,
  SCOPE_LABELS,
  describeSharing,
  grantedScopes,
} from '../logic'
import { useConsents, useGrantConsent, useRevokeConsent } from '../hooks'
import type { ConsentScope } from '../types'

export function SharingPanel() {
  const { partnerRef, isSolo } = useCouple()
  const { user } = useAuth()
  const consents = useConsents()
  const grant = useGrantConsent()
  const revoke = useRevokeConsent()

  if (isSolo || !partnerRef) {
    return (
      <EmptyState
        title="Nobody to share with yet"
        description="When you pair with someone, you can choose what — if anything — they see. The default is nothing."
      />
    )
  }

  const granted = grantedScopes(consents.data ?? [], partnerRef.id)
  const them = partnerRef.displayName

  const toggle = (scope: ConsentScope, on: boolean) => {
    if (on) grant.mutate(scope)
    else revoke.mutate(scope)
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-5">
        <div className="flex items-start gap-2">
          {granted.length === 0 ? (
            <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          ) : (
            <ShieldOff className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          )}
          <div>
            <p className="text-sm font-medium">{describeSharing(granted)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {granted.length === 0
                ? `${them} cannot see any of this.`
                : `${them} can see the above, and nothing else. Turning something off takes effect immediately.`}
            </p>
          </div>
        </div>
      </Card>

      <Card className="divide-y divide-border p-0">
        {SCOPES.map((scope) => {
          const on = granted.includes(scope)
          return (
            <label
              key={scope}
              className="flex cursor-pointer items-start justify-between gap-4 p-4"
            >
              <span className="min-w-0">
                <span className={cn('block text-sm font-medium', on && 'text-foreground')}>
                  {SCOPE_LABELS[scope]}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {SCOPE_DESCRIPTIONS[scope]}
                </span>
              </span>
              <input
                type="checkbox"
                className="mt-0.5 size-4 shrink-0"
                checked={on}
                aria-label={`Share ${SCOPE_LABELS[scope]} with ${them}`}
                disabled={grant.isPending || revoke.isPending || !user}
                onChange={(e) => toggle(scope, e.target.checked)}
              />
            </label>
          )
        })}
      </Card>

      <p className="text-xs text-muted-foreground">
        These are enforced by the database, not by this screen. Anything switched off here cannot
        be read by {them} at all, whatever they open.
      </p>
    </div>
  )
}
