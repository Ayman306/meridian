/**
 * Who is in this space, what they can see, and how to invite somebody else.
 *
 * Two rules are visible on this screen rather than merely enforced behind it,
 * because a permission model people cannot see is one they will not trust:
 *
 * 1. **An invite goes to an email address.** The code is not a password; the
 *    address is. Somebody else holding the code cannot use it.
 * 2. **Some things are never shared.** Documents, stay allowance and health
 *    are greyed out with the reason attached, rather than offered and then
 *    refused on save.
 */
'use client'

import { useState } from 'react'
import { Check, Copy, Lock, Mail, ShieldCheck, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { EmptyState, ErrorState, SkeletonList } from '@/components/common/states'
import { PersonBadge } from '@/components/PersonBadge'
import { cn } from '@/lib/utils'
import { useCouple } from '@/providers/CoupleProvider'
import { useAuth } from '@/providers/AuthProvider'
import {
  ALL_MODULES,
  DEFAULT_GUEST_MODULES,
  MODULE_DESCRIPTIONS,
  MODULE_LABELS,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  canGrant,
  describeAccess,
  isOwning,
  isSensitive,
  normaliseGrants,
} from '../logic'
import {
  useCreateInvite,
  useInvites,
  useMembers,
  useRemoveMember,
  useRevokeInvite,
  useSetMemberGrants,
} from '../hooks'
import type { MemberRole, ModuleName } from '../types'

export function AccessPanel({ canManage }: { canManage: boolean }) {
  const { selfRef, partnerRef } = useCouple()
  const { user } = useAuth()
  const members = useMembers()
  const invites = useInvites()
  const createInvite = useCreateInvite()
  const revokeInvite = useRevokeInvite()
  const setGrants = useSetMemberGrants()
  const removeMember = useRemoveMember()

  const [inviting, setInviting] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Exclude<MemberRole, 'owner'>>('partner')
  const [grants, setSelectedGrants] = useState<ModuleName[]>(DEFAULT_GUEST_MODULES)
  const [copied, setCopied] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [editingGrants, setEditingGrants] = useState<string | null>(null)

  const personFor = (userId: string) =>
    userId === selfRef?.id ? selfRef : userId === partnerRef?.id ? partnerRef : null

  const submit = () => {
    createInvite.mutate(
      {
        email: email.trim(),
        role,
        // A partner sees everything; only limited roles carry a list.
        grants: role === 'partner' ? null : normaliseGrants(role, grants),
      },
      {
        onSuccess: () => {
          setInviting(false)
          setEmail('')
        },
      },
    )
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-sm font-medium">Who can see what</h2>
        </div>

        {members.isLoading ? (
          <SkeletonList rows={2} />
        ) : members.error ? (
          <ErrorState error={members.error} title="Could not read the members" />
        ) : (
          <ul className="divide-y divide-border">
            {members.data?.map((member) => {
              const person = personFor(member.userId)
              const isMe = member.userId === user?.id
              const owning = isOwning(member.role)
              return (
                <li key={member.userId} className="space-y-2 py-3 first:pt-0">
                  <div className="flex items-center gap-3">
                    <PersonBadge person={person} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {isMe ? 'You' : (person?.displayName ?? 'Someone')}
                        <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
                          {ROLE_LABELS[member.role]}
                        </span>
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {describeAccess(member.role, member.grants)}
                      </p>
                    </div>

                    {canManage && !owning && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setEditingGrants(editingGrants === member.userId ? null : member.userId)
                          }
                        >
                          {editingGrants === member.userId ? 'Done' : 'Change'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove ${person?.displayName ?? 'this person'}`}
                          onClick={() => setRemoving(member.userId)}
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </Button>
                      </>
                    )}
                  </div>

                  {editingGrants === member.userId && (
                    <ModuleChecklist
                      role={member.role}
                      selected={member.grants ?? []}
                      onChange={(next) =>
                        setGrants.mutate({ userId: member.userId, grants: next })
                      }
                    />
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {canManage && (
        <Card className="space-y-4 p-5">
          <div className="flex items-center gap-2">
            <Mail className="size-4 text-muted-foreground" aria-hidden="true" />
            <h2 className="text-sm font-medium">Invite someone</h2>
          </div>

          <p className="rounded-md bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
            An invite is issued to one email address and only that address can use it. Sharing the
            code with anyone else does not let them in.
          </p>

          {inviting ? (
            <div className="space-y-4">
              <div className="space-y-1">
                <label htmlFor="invite-email" className="text-sm font-medium">
                  Their email address
                </label>
                <Input
                  id="invite-email"
                  type="email"
                  autoFocus
                  placeholder="them@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  It must be the address they sign in to Google with.
                </p>
              </div>

              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">What are they to you?</legend>
                <div className="grid gap-2 sm:grid-cols-3">
                  {(['partner', 'friend', 'guest'] as const).map((option) => (
                    <label
                      key={option}
                      className={cn(
                        'cursor-pointer rounded-md border p-3 text-sm',
                        role === option ? 'border-accent bg-accent/10' : 'border-input',
                      )}
                    >
                      <input
                        type="radio"
                        name="invite-role"
                        value={option}
                        checked={role === option}
                        className="sr-only"
                        onChange={() => setRole(option)}
                      />
                      <span className="font-medium">{ROLE_LABELS[option]}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {ROLE_DESCRIPTIONS[option]}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              {role !== 'partner' && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">What may they see?</p>
                  <ModuleChecklist role={role} selected={grants} onChange={setSelectedGrants} />
                </div>
              )}

              {createInvite.error ? (
                <ErrorState error={createInvite.error} title="That invite was not sent" />
              ) : null}

              <div className="flex gap-2">
                <Button onClick={submit} disabled={!email.trim() || createInvite.isPending}>
                  {createInvite.isPending ? 'Creating…' : 'Create invite'}
                </Button>
                <Button variant="ghost" onClick={() => setInviting(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" onClick={() => setInviting(true)}>
              Invite someone
            </Button>
          )}

          {invites.isLoading ? (
            <SkeletonList rows={1} />
          ) : (invites.data?.length ?? 0) === 0 ? (
            <EmptyState title="No invites waiting" subtle />
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {invites.data!.map((invite) => (
                <li key={invite.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{invite.invited_email}</p>
                    <p className="text-xs text-muted-foreground">
                      {ROLE_LABELS[invite.role as MemberRole]} ·{' '}
                      {describeAccess(
                        invite.role as MemberRole,
                        (invite.module_grants as ModuleName[] | null) ?? null,
                      )}{' '}
                      · expires {new Date(invite.expires_at).toLocaleDateString()}
                    </p>
                  </div>
                  <code className="rounded bg-secondary px-2 py-1 font-mono text-sm tracking-wider">
                    {invite.code}
                  </code>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Copy the code for ${invite.invited_email}`}
                    onClick={() => {
                      void navigator.clipboard.writeText(invite.code)
                      setCopied(invite.id)
                      window.setTimeout(() => setCopied(null), 1500)
                    }}
                  >
                    {copied === invite.id ? (
                      <Check className="size-4 text-accent" aria-hidden="true" />
                    ) : (
                      <Copy className="size-4" aria-hidden="true" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Revoke the invite to ${invite.invited_email}`}
                    onClick={() => revokeInvite.mutate(invite.id)}
                  >
                    <X className="size-4" aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <ConfirmDialog
        open={removing !== null}
        title="Remove them from this space?"
        description="They lose access immediately. Nothing they added is deleted."
        confirmLabel="Remove"
        destructive
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) removeMember.mutate(removing)
          setRemoving(null)
        }}
      />
    </div>
  )
}

/**
 * The grant checklist.
 *
 * The sensitive three are rendered, disabled, with the reason — rather than
 * omitted. Leaving them out would look like an oversight; showing them locked
 * says the rule exists on purpose.
 */
function ModuleChecklist({
  role,
  selected,
  onChange,
}: {
  role: MemberRole
  selected: ModuleName[]
  onChange: (next: ModuleName[]) => void
}) {
  const toggle = (module: ModuleName) =>
    onChange(
      selected.includes(module)
        ? selected.filter((m) => m !== module)
        : normaliseGrants(role, [...selected, module]),
    )

  return (
    <ul className="grid gap-1.5 sm:grid-cols-2">
      {ALL_MODULES.map((module) => {
        const allowed = canGrant(role, module)
        return (
          <li key={module}>
            <label
              className={cn(
                'flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-sm',
                !allowed && 'cursor-not-allowed border-dashed opacity-60',
                allowed && selected.includes(module) ? 'border-accent bg-accent/10' : 'border-input',
              )}
            >
              <input
                type="checkbox"
                className="mt-0.5"
                disabled={!allowed}
                checked={allowed && selected.includes(module)}
                onChange={() => allowed && toggle(module)}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 font-medium">
                  {MODULE_LABELS[module]}
                  {isSensitive(module) && (
                    <Lock className="size-3 text-muted-foreground" aria-hidden="true" />
                  )}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {allowed
                    ? MODULE_DESCRIPTIONS[module]
                    : 'Never shared outside the couple.'}
                </span>
              </span>
            </label>
          </li>
        )
      })}
    </ul>
  )
}
