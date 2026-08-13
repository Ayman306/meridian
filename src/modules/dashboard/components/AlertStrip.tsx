'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { VISIBLE_ALERTS } from '../logic'
import type { Alert } from '../types'

/**
 * Sorted by severity, capped at three, the rest behind "see all" (spec 2.7).
 * An alert strip that shows everything stops being an alert strip.
 */
export function AlertStrip({ alerts }: { alerts: Alert[] }) {
  const [expanded, setExpanded] = useState(false)
  if (alerts.length === 0) return null

  const shown = expanded ? alerts : alerts.slice(0, VISIBLE_ALERTS)
  const hidden = alerts.length - shown.length

  return (
    <div className="space-y-2">
      {shown.map((alert, i) => (
        <AlertRow key={`${alert.kind}-${alert.href ?? i}`} alert={alert} />
      ))}

      {hidden > 0 && (
        <button
          onClick={() => setExpanded(true)}
          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          See {hidden} more
        </button>
      )}
    </div>
  )
}

function AlertRow({ alert }: { alert: Alert }) {
  const body = (
    <div
      className={cn(
        'flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-sm',
        alert.severity === 'blocking'
          ? 'border-destructive/30 bg-destructive/5'
          : 'border-[hsl(var(--warn))]/30 bg-[hsl(var(--warn))]/5',
      )}
    >
      <AlertTriangle
        className={cn(
          'mt-0.5 size-4 shrink-0',
          alert.severity === 'blocking' ? 'text-destructive' : 'text-[hsl(var(--warn))]',
        )}
        aria-hidden="true"
      />
      <div className="min-w-0">
        <p className="font-medium">{alert.title}</p>
        {alert.detail && <p className="text-xs text-muted-foreground">{alert.detail}</p>}
      </div>
    </div>
  )

  return alert.href ? (
    <Link href={alert.href} className="block">
      {body}
    </Link>
  ) : (
    body
  )
}
