/**
 * The four states every data view must handle (spec 0.7). No exceptions.
 *
 *   Loading  → <Skeleton /> shaped like the final layout, never a page spinner
 *   Error    → <ErrorState onRetry /> that says what failed
 *   Empty    → <EmptyState action /> — an invitation with one clear action
 *   Restful  → <RestfulEmpty /> — blank by design, offers nothing
 *
 * The last two are genuinely different things. An open day on a long stay is
 * not a gap to be filled; it is the point of the trip. See Module 5.
 */
import type { ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { userMessage } from '@/lib/errors'

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('relative overflow-hidden rounded-md bg-muted', className)}
      aria-hidden="true"
    >
      <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.6s_infinite] bg-gradient-to-r from-transparent via-background/40 to-transparent" />
    </div>
  )
}

/** A stack of skeleton rows, shaped like a list. */
export function SkeletonList({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-3', className)} role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="rounded-lg border border-border p-4">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="mt-2.5 h-3 w-1/2" />
        </div>
      ))}
    </div>
  )
}

export function ErrorState({
  error,
  onRetry,
  title = "That didn't load",
  className,
}: {
  error?: unknown
  onRetry?: () => void
  title?: string
  className?: string
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center gap-3 rounded-lg border border-destructive/25 bg-destructive/5 p-8 text-center',
        className,
      )}
    >
      <AlertTriangle className="size-5 text-destructive" aria-hidden="true" />
      <div>
        <p className="font-medium">{title}</p>
        {error !== undefined && (
          <p className="mt-1 text-sm text-muted-foreground">{userMessage(error)}</p>
        )}
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw aria-hidden="true" />
          Try again
        </Button>
      )}
    </div>
  )
}

/**
 * Nothing here yet, and there should be. An invitation with exactly one action.
 */
export function EmptyState({
  title,
  description,
  action,
  icon,
  subtle = false,
  className,
}: {
  title: string
  description?: string
  action?: ReactNode
  icon?: ReactNode
  subtle?: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-2 text-center',
        subtle ? 'py-4' : 'rounded-lg border border-dashed border-border py-12',
        className,
      )}
    >
      {icon && !subtle && <div className="text-muted-foreground">{icon}</div>}
      <p className={cn('font-medium', subtle && 'text-sm text-muted-foreground')}>{title}</p>
      {description && !subtle && (
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

/**
 * Blank on purpose. An open day on a long stay, a quiet week.
 *
 * This component takes no `action` prop, deliberately. If you find yourself
 * wanting to add one, you want EmptyState instead.
 */
export function RestfulEmpty({ label = 'Open', className }: { label?: string; className?: string }) {
  return (
    <div className={cn('py-6 text-center text-sm text-muted-foreground/60', className)}>
      {label}
    </div>
  )
}

export function PageLoading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="space-y-4" role="status" aria-label={label}>
      <Skeleton className="h-8 w-48" />
      <SkeletonList rows={3} />
    </div>
  )
}
