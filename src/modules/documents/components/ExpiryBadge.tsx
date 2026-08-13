'use client'

import { Badge } from '@/components/ui/card'
import type { ExpiryStatus } from '../types'

/**
 * Colour follows the spec's bands: green over a year, amber inside one, red
 * inside three months. The message matters more than the colour — a passport
 * showing amber with no explanation tells you nothing about the 6-month rule.
 */
export function ExpiryBadge({ status, expiresOn }: { status: ExpiryStatus; expiresOn: string | null }) {
  if (status.level === 'none') {
    return <span className="text-xs text-muted-foreground">No expiry</span>
  }

  const tone = (
    {
      expired: 'danger',
      blocking: 'danger',
      warning: 'warn',
      ok: 'ok',
      none: 'neutral',
    } as const
  )[status.level]

  const label =
    status.level === 'expired'
      ? 'Expired'
      : status.months !== null && status.months < 24
        ? `${status.months} mo`
        : expiresOn?.slice(0, 4)

  return (
    <span className="inline-flex items-center gap-2">
      <Badge tone={tone}>{label}</Badge>
      {status.message && (
        <span className="text-xs text-[hsl(var(--warn))]">{status.message}</span>
      )}
    </span>
  )
}
