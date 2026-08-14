/**
 * Create or join a couple. This screen is where a solo user lives — possibly
 * for days — so it has to be a pleasant place to wait, not a blocker.
 */
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Copy, RefreshCw } from 'lucide-react'
import { useCouple } from '@/providers/CoupleProvider'
import { useAuth } from '@/providers/AuthProvider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Field } from '@/components/ui/input'
import { ErrorState, PageLoading } from '@/components/common/states'
import { useCreateCouple, useJoinCouple } from '@/modules/auth/hooks'
import { useCreateInvite, useInvites } from '@/modules/settings'
import {
  describeInviteExpiry,
  isPlausibleInviteCode,
  normaliseInviteCode,
} from '@/modules/auth/logic'
import { userMessage } from '@/lib/errors'

export function PairPage() {
  const { couple, isLoading, isSolo } = useCouple()
  const { signOut } = useAuth()
  const router = useRouter()

  // Both members present and the code spent — this page has nothing left to do.
  const paired = Boolean(couple) && !isSolo && !couple?.invite_code
  useEffect(() => {
    if (paired) router.replace('/')
  }, [paired, router])

  if (isLoading) {
    return (
      <main className="mx-auto max-w-lg px-6 py-16">
        <PageLoading />
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-lg space-y-6 px-6 py-12">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Pair up</h1>
        <p className="text-sm text-muted-foreground">
          Meridian is built for exactly two people. Start a couple and send the code, or enter the
          one you were sent.
        </p>
      </header>

      {couple ? <InviteCard /> : <CreateCard />}

      <JoinCard disabled={Boolean(couple)} />

      <div className="pt-4 text-center">
        <Button variant="link" size="sm" onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>
    </main>
  )
}

function CreateCard() {
  const create = useCreateCouple()
  const [name, setName] = useState('')

  return (
    <Card>
      <CardHeader>
        <CardTitle>Start a couple</CardTitle>
        <CardDescription>You&apos;ll get a code to send to your partner.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Field label="Name it (optional)" htmlFor="couple-name">
          <Input
            id="couple-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Sam & Alex"
            maxLength={80}
          />
        </Field>
        <Button
          className="w-full"
          disabled={create.isPending}
          onClick={() => create.mutate(name.trim() || undefined)}
        >
          {create.isPending ? 'Creating…' : 'Create'}
        </Button>
        {create.error ? <ErrorState error={create.error} title="Could not create" /> : null}
      </CardContent>
    </Card>
  )
}

/**
 * Issue an invite.
 *
 * The code on its own no longer admits anybody — `join_couple` compares the
 * address on the account signing in against the one this was issued to. That
 * is the whole reason this asks for an email before it will mint anything, and
 * the copy says so, because a code that looks like a password but is not would
 * be worse than either.
 */
function InviteCard() {
  const createInvite = useCreateInvite()
  const invites = useInvites()
  const [email, setEmail] = useState('')
  const [copied, setCopied] = useState(false)

  const live = invites.data?.[0] ?? null

  const copy = async () => {
    if (!live) return
    await navigator.clipboard.writeText(live.code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invite your partner</CardTitle>
        <CardDescription>
          {live
            ? `Sent to ${live.invited_email}. ${describeInviteExpiry(live.expires_at)}`
            : 'It goes to one email address, and only that address can use it.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {live ? (
          <>
            <div className="flex items-center gap-2">
              <output className="tabular flex-1 rounded-md border border-border bg-secondary px-4 py-3 text-center text-2xl font-semibold tracking-[0.3em]">
                {live.code}
              </output>
              <Button
                variant="outline"
                size="icon"
                onClick={() => void copy()}
                aria-label="Copy code"
              >
                {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Send them this code however you like. It only works for{' '}
              <strong>{live.invited_email}</strong>, so it is safe to read out.
            </p>
            <p className="text-xs text-muted-foreground">
              Waiting for them to join. This page updates once they do — you can close it.
            </p>
          </>
        ) : (
          <>
            <div className="space-y-1">
              <label htmlFor="invite-to" className="text-sm font-medium">
                Their email address
              </label>
              <Input
                id="invite-to"
                type="email"
                placeholder="them@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                It has to be the address they sign in to Google with.
              </p>
            </div>
            <Button
              className="w-full"
              disabled={!email.trim() || createInvite.isPending}
              onClick={() =>
                createInvite.mutate(
                  { email: email.trim(), role: 'partner', grants: null },
                  { onSuccess: () => setEmail('') },
                )
              }
            >
              <RefreshCw aria-hidden="true" />
              {createInvite.isPending ? 'Creating…' : 'Create invite'}
            </Button>
          </>
        )}

        {createInvite.error ? (
          <p className="text-sm text-destructive" role="alert">
            {userMessage(createInvite.error)}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

function JoinCard({ disabled }: { disabled: boolean }) {
  const join = useJoinCouple()
  const [code, setCode] = useState('')
  const valid = isPlausibleInviteCode(code)

  return (
    <Card className={disabled ? 'opacity-60' : undefined}>
      <CardHeader>
        <CardTitle>Join with a code</CardTitle>
        <CardDescription>
          {disabled
            ? "You've already started a couple. Leave it in Settings first."
            : 'Eight characters, from your partner.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Field label="Invite code" htmlFor="invite-code">
          <Input
            id="invite-code"
            value={code}
            disabled={disabled}
            onChange={(e) => setCode(normaliseInviteCode(e.target.value))}
            placeholder="ABCD2345"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            className="tabular text-center text-lg tracking-[0.3em]"
          />
        </Field>
        <Button
          className="w-full"
          disabled={disabled || !valid || join.isPending}
          onClick={() => join.mutate(code)}
        >
          {join.isPending ? 'Joining…' : 'Join'}
        </Button>
        {join.error ? (
          <p className="text-sm text-destructive" role="alert">
            {userMessage(join.error)}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
