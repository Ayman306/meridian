/**
 * Whose pick. Appears on itinerary items, wishlist entries, documents and
 * anywhere else the answer to "who wanted this?" matters.
 */
import { ACCENT_COLORS, type AccentColor } from '@/lib/constants'
import type { PersonRef } from '@/types/domain'
import { cn, initials } from '@/lib/utils'

export function PersonBadge({
  person,
  size = 'sm',
  withName = false,
  className,
}: {
  person: PersonRef | null
  size?: 'xs' | 'sm' | 'md'
  withName?: boolean
  className?: string
}) {
  if (!person) return null

  const dims = { xs: 'size-5 text-[10px]', sm: 'size-6 text-[11px]', md: 'size-8 text-xs' }[size]
  const hue = ACCENT_COLORS[person.accentColor as AccentColor] ?? ACCENT_COLORS.amber

  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span
        className={cn(
          'inline-flex items-center justify-center overflow-hidden rounded-full font-semibold text-black/80 ring-1 ring-black/5',
          dims,
        )}
        style={{ backgroundColor: `hsl(${hue})` }}
        title={person.displayName}
      >
        {person.avatarUrl ? (
          <img
            src={person.avatarUrl}
            alt=""
            className="size-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          initials(person.displayName)
        )}
      </span>
      {withName && (
        <span className="text-sm text-muted-foreground">
          {person.isSelf ? 'You' : person.displayName}
        </span>
      )}
      <span className="sr-only">{person.isSelf ? 'Your pick' : `${person.displayName}'s pick`}</span>
    </span>
  )
}
