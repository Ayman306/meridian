/**
 * Sending what changes to whatever else you use.
 *
 * The app knows nothing about Slack, Discord, Home Assistant, n8n or IFTTT —
 * it posts a signed JSON body to a URL you paste, and whatever is at the other
 * end decides what that means. One generic act, and all of those work without
 * a line of code each.
 *
 * Together with the assistant connection above it, that is both directions: an
 * assistant is how things get *in*, a webhook is how things get *out*.
 *
 * ## The secret is shown once
 *
 * Exactly like an access token, and for the same reason: anything holding it
 * can forge a signature, so the database refuses to give it back — even to the
 * person who made it. Losing it means replacing the integration, which is a
 * worse outcome than a scary sentence at the right moment.
 */
'use client'

import { useState } from 'react'
import { Check, Copy, Plus, Trash2, Webhook } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { EmptyState, ErrorState, SkeletonList } from '@/components/common/states'
import {
  useAddIntegration,
  useIntegrations,
  useRemoveIntegration,
  useSetIntegrationEnabled,
} from '../hooks'
import { ALL_EVENTS, EVENT_LABELS } from '../logic'
import type { ActivityEvent } from '../types'

export function IntegrationsPanel() {
  const integrations = useIntegrations()
  const add = useAddIntegration()
  const setEnabled = useSetIntegrationEnabled()
  const remove = useRemoveIntegration()

  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [secret, setSecret] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const rows = integrations.data ?? []
  // https only, matched here as well as by the database's own constraint —
  // a refusal after a round trip is a worse way to learn the same thing.
  const urlOk = /^https:\/\/.+/i.test(url.trim())

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <Webhook className="size-4" aria-hidden="true" />
          Send changes elsewhere
        </h2>
        {!adding && !secret && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus aria-hidden="true" />
            Add a webhook
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        When either of you adds a place, books a stay, logs an expense or adds a flight, we POST a
        signed JSON body to a URL you choose. Point it at Slack, Discord, Home Assistant, n8n,
        Zapier — anything that accepts a webhook.
      </p>

      {secret && (
        <div className="space-y-2 rounded-lg border border-[hsl(var(--warn))]/40 bg-[hsl(var(--warn))]/10 p-3">
          <p className="text-sm font-medium">Your signing secret — copy it now</p>
          <p className="text-xs text-muted-foreground">
            Verify it as <code>HMAC-SHA256</code> over{' '}
            <code>{'{X-Meridian-Timestamp}.{body}'}</code>, compared against{' '}
            <code>X-Meridian-Signature</code>. This is the only time it is shown; it cannot be read
            back, even by you.
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-background px-2 py-1 text-xs">
              {secret}
            </code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(secret)
                setCopied(true)
              }}
            >
              {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <Button size="sm" onClick={() => { setSecret(null); setCopied(false) }}>
            I have saved it
          </Button>
        </div>
      )}

      {adding && (
        <form
          className="space-y-3 rounded-lg border border-border p-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (!name.trim() || !urlOk) return
            add.mutate(
              { name: name.trim(), url: url.trim(), events },
              {
                onSuccess: ({ secret: created }) => {
                  setSecret(created)
                  setAdding(false)
                  setName('')
                  setUrl('')
                  setEvents([])
                },
              },
            )
          }}
        >
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">What is it</span>
            <Input value={name} placeholder="Our Discord" onChange={(e) => setName(e.target.value)} />
          </label>

          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">
              Where to POST — https only, and never a private address
            </span>
            <Input
              type="url"
              value={url}
              placeholder="https://hooks.example.com/…"
              onChange={(e) => setUrl(e.target.value)}
            />
            {url.trim().length > 0 && !urlOk && (
              <span className="text-xs text-destructive">That has to be an https:// URL.</span>
            )}
          </label>

          <fieldset className="space-y-1">
            <legend className="text-xs text-muted-foreground">
              Which changes — none selected means all of them
            </legend>
            <div className="flex flex-wrap gap-1.5">
              {ALL_EVENTS.map((event) => {
                const on = events.includes(event)
                return (
                  <button
                    key={event}
                    type="button"
                    aria-pressed={on}
                    className={
                      on
                        ? 'rounded-full bg-secondary px-2.5 py-1 text-xs font-medium'
                        : 'rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground'
                    }
                    onClick={() =>
                      setEvents((current) =>
                        on ? current.filter((e) => e !== event) : [...current, event],
                      )
                    }
                  >
                    {EVENT_LABELS[event]}
                  </button>
                )
              })}
            </div>
          </fieldset>

          {add.error ? <ErrorState error={add.error} title="That did not save" /> : null}

          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={!name.trim() || !urlOk || add.isPending}>
              {add.isPending ? 'Adding…' : 'Add'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {integrations.isLoading ? (
        <SkeletonList rows={1} />
      ) : integrations.error ? (
        <ErrorState error={integrations.error} onRetry={() => void integrations.refetch()} />
      ) : rows.length === 0 ? (
        !adding && (
          <EmptyState
            subtle
            title="Nothing connected"
            description="Useful for a shared channel that says “Ayman saved a place” without either of you having to mention it."
          />
        )
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.id} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">{row.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{row.url}</p>
                  <p className="text-xs text-muted-foreground">
                    {row.events.length === 0
                      ? 'Every change'
                      : row.events.map((e) => EVENT_LABELS[e]).join(', ')}
                  </p>
                  {/* The last attempt, plainly. "Did this work" is the only
                      question anybody asks of a webhook. */}
                  {row.lastDeliveredAt && (
                    <p
                      className={
                        row.lastError
                          ? 'text-xs text-destructive'
                          : 'text-xs text-[hsl(var(--ok))]'
                      }
                    >
                      {row.lastError
                        ? `Last attempt failed: ${row.lastError}`
                        : `Delivered, HTTP ${row.lastStatus}`}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="sm"
                    variant={row.enabled ? 'secondary' : 'ghost'}
                    aria-pressed={row.enabled}
                    onClick={() => setEnabled.mutate({ id: row.id, enabled: !row.enabled })}
                  >
                    {row.enabled ? 'On' : 'Off'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${row.name}`}
                    onClick={() => remove.mutate(row.id)}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
