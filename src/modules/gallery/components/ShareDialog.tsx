/**
 * Make a link. Spec 11.3.
 *
 * Three deliberate defaults: seven days, downloads off, no passcode. A share
 * is a loan — the expiry is the point, and the app should not quietly make
 * permanent public copies of a couple's photos because permanent was easier to
 * implement.
 *
 * The URL never contains a storage path. `/s/:token` resolves server-side and
 * mints a short-lived signed URL per view, which is what makes "revoke"
 * actually revoke rather than just hide a link somebody already copied.
 */
'use client'

import { useState } from 'react'
import { Check, Copy, Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Input, Select } from '@/components/ui/input'
import { userMessage } from '@/lib/errors'
import { formatInZone } from '@/lib/dates'
import { useCouple } from '@/providers/CoupleProvider'
import { useCreateShare, useRevokeShare, useShareLinks } from '../hooks'
import type { ShareTarget } from '../types'

export function ShareDialog({
  target,
  onClose,
}: {
  target: { type: ShareTarget; id: string }
  onClose: () => void
}) {
  const { tzSelf } = useCouple()
  const create = useCreateShare()
  const revoke = useRevokeShare()
  const links = useShareLinks()

  const [days, setDays] = useState(7)
  const [allowDownload, setAllowDownload] = useState(false)
  const [passcode, setPasscode] = useState('')
  const [url, setUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const existing = (links.data ?? []).filter((link) => link.target_id === target.id)

  const make = async () => {
    const link = await create.mutateAsync({
      target,
      options: { allowDownload, expiresInDays: days, passcode: passcode || null },
    })
    setUrl(`${window.location.origin}/s/${link.token}`)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-base">Share this {target.type}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {url ? (
            <>
              <Field label="The link" htmlFor="share-url">
                <div className="flex gap-2">
                  <Input id="share-url" readOnly value={url} onFocus={(e) => e.target.select()} />
                  <Button
                    variant="outline"
                    onClick={() => {
                      void navigator.clipboard.writeText(url)
                      setCopied(true)
                    }}
                  >
                    {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                    {copied ? 'Copied' : 'Copy'}
                  </Button>
                </div>
              </Field>
              <p className="text-xs text-muted-foreground">
                Anyone with this link can see it until it expires. You can revoke it at any time
                and it stops working immediately.
              </p>
              <Button onClick={onClose}>Done</Button>
            </>
          ) : (
            <>
              <Field label="Expires after" htmlFor="share-days">
                <Select
                  id="share-days"
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                >
                  <option value={1}>A day</option>
                  <option value={7}>A week</option>
                  <option value={30}>A month</option>
                </Select>
              </Field>

              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4"
                  checked={allowDownload}
                  onChange={(e) => setAllowDownload(e.target.checked)}
                />
                <span>
                  Allow downloads
                  <span className="block text-xs text-muted-foreground">
                    Off by default. Viewing is a loan; downloading is a copy.
                  </span>
                </span>
              </label>

              <Field
                label="Passcode"
                hint="Optional. They will be asked for it before anything loads."
                htmlFor="share-passcode"
              >
                <Input
                  id="share-passcode"
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                />
              </Field>

              {create.error ? (
                <p className="text-sm text-destructive" role="alert">
                  {userMessage(create.error)}
                </p>
              ) : null}

              <div className="flex gap-2">
                <Button disabled={create.isPending} onClick={() => void make()}>
                  <Link2 aria-hidden="true" />
                  {create.isPending ? 'Making…' : 'Make a link'}
                </Button>
                <Button variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
              </div>
            </>
          )}

          {existing.length > 0 && (
            <div className="space-y-2 border-t border-border pt-3">
              <p className="text-xs font-medium text-muted-foreground">Links already out there</p>
              {existing.map((link) => (
                <div key={link.id} className="flex items-center gap-3 text-xs">
                  <span className="mr-auto text-muted-foreground">
                    Expires {formatInZone(link.expires_at, tzSelf, 'd MMM')} · {link.view_count}{' '}
                    views
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => revoke.mutate(link.id)}>
                    Revoke
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
