/**
 * The public view. Spec 11.6's `/s/:token`.
 *
 * Outside the app shell and outside auth — whoever opens this has a link and
 * nothing else. It asks the Route Handler, which does every check and returns
 * short-lived signed URLs; this page never sees a storage path and cannot
 * construct one.
 *
 * A revoked or expired link gets a plain sentence, not a stack trace and not a
 * hint about which of the two it was.
 */
'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/common/states'
import { APP_NAME } from '@/lib/constants'
import type { SharedPayload } from '../types'

type Resolution =
  | { kind: 'ok'; payload: SharedPayload }
  | { kind: 'passcode' }
  | { kind: 'error'; message: string }

async function resolve(token: string, passcode: string): Promise<Resolution> {
  const url = new URL(`/api/share/${token}`, window.location.origin)
  if (passcode) url.searchParams.set('passcode', passcode)

  const res = await fetch(url)
  const body = (await res.json()) as SharedPayload & { error?: string; needsPasscode?: boolean }

  if (body.needsPasscode) return { kind: 'passcode' }
  if (!res.ok) return { kind: 'error', message: body.error ?? 'That link is no longer available.' }
  return { kind: 'ok', payload: body }
}

export function SharePage({ token }: { token: string }) {
  const [passcode, setPasscode] = useState('')
  // Only bumped on submit, so typing does not re-request on every keystroke.
  const [submitted, setSubmitted] = useState('')

  // A query rather than an effect: this is a fetch keyed by the token and the
  // passcode, which is exactly what a query key is for, and it keeps the
  // loading and error states out of hand-rolled state.
  const share = useQuery({
    queryKey: ['share', token, submitted] as const,
    queryFn: () => resolve(token, submitted),
    retry: false,
    refetchOnWindowFocus: false,
  })

  const result = share.data

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <p className="mb-8 text-sm text-muted-foreground">Shared from {APP_NAME}</p>

      {share.isLoading && <Skeleton className="h-64 w-full rounded-lg" />}

      {result?.kind === 'passcode' && (
        <form
          className="mx-auto max-w-sm space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            setSubmitted(passcode)
          }}
        >
          <p className="text-sm">This one needs a passcode.</p>
          <Input
            type="password"
            value={passcode}
            aria-label="Passcode"
            onChange={(e) => setPasscode(e.target.value)}
          />
          <Button type="submit">Open</Button>
          {submitted !== '' && (
            <p className="text-sm text-destructive" role="alert">
              That passcode is not right.
            </p>
          )}
        </form>
      )}

      {result?.kind === 'error' && (
        <p className="text-center text-muted-foreground">{result.message}</p>
      )}

      {share.isError && (
        <p className="text-center text-muted-foreground">Could not load that link.</p>
      )}

      {result?.kind === 'ok' && (
        <div className="space-y-6">
          {result.payload.title && (
            <h1 className="text-2xl font-semibold">{result.payload.title}</h1>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {result.payload.items.map((item) => (
              <figure key={item.id} className="space-y-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.url}
                  alt={item.caption ?? ''}
                  className="w-full rounded-lg"
                  loading="lazy"
                />
                {item.caption && (
                  <figcaption className="text-sm text-muted-foreground">{item.caption}</figcaption>
                )}
                {result.payload.allowDownload && (
                  <a
                    href={item.url}
                    download
                    className="text-xs text-muted-foreground underline underline-offset-4"
                  >
                    Download
                  </a>
                )}
              </figure>
            ))}
          </div>
        </div>
      )}
    </main>
  )
}
