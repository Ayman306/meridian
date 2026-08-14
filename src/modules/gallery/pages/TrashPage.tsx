/**
 * The bin. Spec 11.3: soft delete, restorable, and hard-deleted after 30 days.
 *
 * The countdown is shown per photo rather than described in the abstract,
 * because "deleted items are removed after 30 days" is a policy and "gone in
 * four days" is a prompt to act.
 */
'use client'

import { useMemo, useState } from 'react'
import { RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState, ErrorState, Skeleton } from '@/components/common/states'
import { SOFT_DELETE_GRACE_DAYS } from '@/lib/constants'
import { pluralise } from '@/lib/utils'
import { Thumb } from '../components/Thumb'
import { useMediaUrls, useRestoreMedia, useTrash } from '../hooks'

export function TrashPage() {
  const trash = useTrash()
  const restore = useRestoreMedia()
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const items = useMemo(() => trash.data ?? [], [trash.data])
  const urls = useMediaUrls(items, 'thumb')

  // The clock is read once, at mount. Calling Date.now() while rendering makes
  // the countdown depend on when React happened to re-render, and nothing on
  // this screen changes within a day anyway.
  const [now] = useState(() => Date.now())

  const daysLeft = (deletedAt: string | null) => {
    if (!deletedAt) return SOFT_DELETE_GRACE_DAYS
    const elapsed = (now - new Date(deletedAt).getTime()) / 86_400_000
    return Math.max(0, Math.ceil(SOFT_DELETE_GRACE_DAYS - elapsed))
  }

  return (
    <div>
      <PageHeader
        title="Trash"
        description={`Photos stay here for ${SOFT_DELETE_GRACE_DAYS} days, then they and their files are removed for good.`}
        actions={
          selected.size > 0 && (
            <Button
              onClick={() => {
                restore.mutate([...selected])
                setSelected(new Set())
              }}
            >
              <RotateCcw aria-hidden="true" />
              Restore {pluralise(selected.size, 'photo')}
            </Button>
          )
        }
      />

      {trash.isLoading ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square" />
          ))}
        </div>
      ) : trash.error ? (
        <ErrorState error={trash.error} onRetry={() => void trash.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Trash2 className="size-5" aria-hidden="true" />}
          title="Nothing in the trash"
          description="Deleted photos wait here in case you change your mind."
        />
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {items.map((item) => (
            <div key={item.id} className="space-y-1">
              <Thumb
                media={item}
                url={urls.data?.[item.id]}
                selected={selected.has(item.id)}
                onOpen={() =>
                  setSelected((prev) => {
                    const next = new Set(prev)
                    if (next.has(item.id)) next.delete(item.id)
                    else next.add(item.id)
                    return next
                  })
                }
                onToggleSelect={() =>
                  setSelected((prev) => {
                    const next = new Set(prev)
                    if (next.has(item.id)) next.delete(item.id)
                    else next.add(item.id)
                    return next
                  })
                }
              />
              <p className="text-center text-[11px] text-muted-foreground">
                {daysLeft(item.deleted_at)} days left
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
