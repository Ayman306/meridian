'use client'

import { cn } from '@/lib/utils'

/**
 * Days used against the limit.
 *
 * Deliberately not green until near the end: an allowance bar is not an
 * achievement, and colouring 30 of 90 days green suggests progress towards
 * something you want. It stays neutral until it is worth noticing.
 */
export function AllowanceBar({
  used,
  limit,
  className,
}: {
  used: number
  limit: number
  className?: string
}) {
  const ratio = limit > 0 ? Math.min(1, used / limit) : 0
  const tone =
    ratio >= 1
      ? 'bg-destructive'
      : ratio > 0.85
        ? 'bg-[hsl(var(--danger))]'
        : ratio > 0.65
          ? 'bg-[hsl(var(--warn))]'
          : 'bg-foreground/40'

  return (
    <div
      className={cn('h-2 w-full overflow-hidden rounded-full bg-muted', className)}
      role="meter"
      aria-valuenow={used}
      aria-valuemin={0}
      aria-valuemax={limit}
      aria-label={`${used} of ${limit} days used`}
    >
      <div className={cn('h-full rounded-full transition-[width]', tone)} style={{ width: `${ratio * 100}%` }} />
    </div>
  )
}
