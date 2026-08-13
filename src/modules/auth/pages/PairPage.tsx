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
import { useCreateCouple, useJoinCouple, useRegenerateInviteCode } from '@/modules/auth/hooks'
import {
  describeInviteExpiry,
  isInviteExpired,
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

      {couple ? <InviteCard couple={couple} /> : <CreateCard />}

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

function InviteCard({
  couple,
}: {
  couple: { id: string; invite_code: string | null; invite_expires_at: string | null }
}) {
  const regenerate = useRegenerateInviteCode()
  const [copied, setCopied] = useState(false)
  const expired = isInviteExpired(couple.invite_expires_at)
  const code = couple.invite_code

  const copy = async () => {
    if (!code) return
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your invite code</CardTitle>
        <CardDescription>
          {code && !expired
            ? describeInviteExpiry(couple.invite_expires_at)
            : 'This code is no longer usable.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {code && !expired ? (
          <div className="flex items-center gap-2">
            <output className="tabular flex-1 rounded-md border border-border bg-secondary px-4 py-3 text-center text-2xl font-semibold tracking-[0.3em]">
              {code}
            </output>
            <Button variant="outline" size="icon" onClick={() => void copy()} aria-label="Copy code">
              {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {expired ? 'It expired.' : 'It has already been used.'} Generate a new one to invite
            someone.
          </p>
        )}

        <Button
          variant="outline"
          className="w-full"
          disabled={regenerate.isPending}
          onClick={() => regenerate.mutate()}
        >
          <RefreshCw aria-hidden="true" />
          {regenerate.isPending ? 'Generating…' : 'New code'}
        </Button>
        {regenerate.error ? (
          <p className="text-sm text-destructive" role="alert">
            {userMessage(regenerate.error)}
          </p>
        ) : null}

        <p className="text-xs text-muted-foreground">
          Waiting for them to join. This page updates once they do — you can close it.
        </p>
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
