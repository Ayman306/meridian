/**
 * The grid. Spec 11.3.
 *
 * Thumbnails only — never the display variant, never an original. Sixty per
 * page, grouped by day, with the thumbhash standing in until each one loads.
 * That combination is what keeps a page of the library under three megabytes.
 */
'use client'

import { useMemo, useState } from 'react'
import { Images, Search, SlidersHorizontal, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input, Select } from '@/components/ui/input'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState, ErrorState, Skeleton } from '@/components/common/states'
import { pluralise } from '@/lib/utils'
import { useCouple } from '@/providers/CoupleProvider'
import { useDistanceUnit } from '@/modules/settings'
import { Lightbox } from '../components/Lightbox'
import { ShareDialog } from '../components/ShareDialog'
import { Thumb } from '../components/Thumb'
import { Uploader } from '../components/Uploader'
import {
  useBulkDownload,
  useDeleteMedia,
  useGalleryRealtime,
  useInfiniteScroll,
  useMediaPages,
  useMediaUrls,
  useUploadQueue,
  useUsage,
} from '../hooks'
import { ExchangeStrip } from '../components/ExchangeStrip'
import { TripRecap } from '../components/TripRecap'
import { STORAGE_BUDGET_BYTES, formatBytes, groupByDay, photosRemaining } from '../logic'
import type { Media, MediaFilters } from '../types'

export function GalleryPage({ tripId }: { tripId?: string } = {}) {
  const { coupleId, tzSelf, selfRef, partnerRef } = useCouple()
  const [filters, setFilters] = useState<MediaFilters>({ tripId: tripId ?? null })
  const [search, setSearch] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [open, setOpen] = useState<Media | null>(null)
  const [sharing, setSharing] = useState<Media | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const pages = useMediaPages(filters)
  const usage = useUsage()
  const remove = useDeleteMedia()
  const queue = useUploadQueue({ tripId: tripId ?? null })
  useGalleryRealtime(coupleId)

  const media = useMemo(() => pages.data?.pages.flatMap((p) => p.items) ?? [], [pages.data])
  const urls = useMediaUrls(media, 'thumb')
  const groups = useMemo(() => groupByDay(media, tzSelf), [media, tzSelf])

  const sentinel = useInfiniteScroll(
    () => void pages.fetchNextPage(),
    Boolean(pages.hasNextPage) && !pages.isFetchingNextPage,
  )
  const download = useBulkDownload()
  const distanceUnit = useDistanceUnit()

  const index = open ? media.findIndex((m) => m.id === open.id) : -1
  const neighbours = {
    previous: index > 0 ? (media[index - 1] ?? null) : null,
    next: index >= 0 && index < media.length - 1 ? (media[index + 1] ?? null) : null,
  }

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const usedBytes = usage.data?.totalBytes ?? 0

  return (
    <div>
      {/* The daily exchange belongs to the days between trips, so it sits on
          the whole-gallery view and not inside one trip. A habit that needs
          navigating to is a habit that stops. */}
      {!tripId && <div className="mb-6"><ExchangeStrip /></div>}

      {/* And the recap belongs to one trip, afterwards. buildRecap has been
          tested since Phase 11 and rendered nowhere. */}
      {tripId && media.length > 0 && (
        <div className="mb-6">
          <TripRecap
            media={media}
            distanceUnit={distanceUnit}
            downloading={download.progress}
            onDownloadAll={() => void download.run(media)}
          />
        </div>
      )}

      {!tripId && (
        <PageHeader
          title="Photos"
          description="Everything you have both taken, in one place."
          actions={
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Filters"
                aria-pressed={showFilters}
                onClick={() => setShowFilters(!showFilters)}
              >
                <SlidersHorizontal aria-hidden="true" />
              </Button>
              <Button onClick={() => setUploading(!uploading)}>
                <Upload aria-hidden="true" />
                Add photos
              </Button>
            </div>
          }
        />
      )}

      {tripId && (
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground">Photos from this trip</h2>
          <Button size="sm" onClick={() => setUploading(!uploading)}>
            <Upload aria-hidden="true" />
            Add photos
          </Button>
        </div>
      )}

      {uploading && (
        <div className="mb-6">
          <Uploader queue={queue} compact={Boolean(tripId)} />
        </div>
      )}

      {showFilters && (
        <Card className="mb-6">
          <CardContent className="grid gap-3 py-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs text-muted-foreground">
              Search captions
              <div className="relative mt-1">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  className="h-9 pl-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') setFilters({ ...filters, search: search || null })
                  }}
                  placeholder="Press enter"
                />
              </div>
            </label>

            {partnerRef && (
              <label className="text-xs text-muted-foreground">
                Taken by
                <Select
                  className="mt-1 h-9"
                  value={filters.uploaderId ?? ''}
                  onChange={(e) => setFilters({ ...filters, uploaderId: e.target.value || null })}
                >
                  <option value="">Either of you</option>
                  {selfRef && <option value={selfRef.id}>You</option>}
                  <option value={partnerRef.id}>{partnerRef.displayName}</option>
                </Select>
              </label>
            )}

            <label className="flex items-end gap-2 pb-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={Boolean(filters.favouritesOnly)}
                onChange={(e) => setFilters({ ...filters, favouritesOnly: e.target.checked })}
              />
              Favourites only
            </label>

            <label className="flex items-end gap-2 pb-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={Boolean(filters.hasLocation)}
                onChange={(e) => setFilters({ ...filters, hasLocation: e.target.checked })}
              />
              Has a location
            </label>
          </CardContent>
        </Card>
      )}

      {selected.size > 0 && (
        <div className="sticky top-16 z-10 mb-4 flex items-center gap-3 rounded-lg border border-border bg-background/95 p-3 shadow-lg backdrop-blur">
          <span className="text-sm">{pluralise(selected.size, 'photo')} selected</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              remove.mutate([...selected])
              setSelected(new Set())
            }}
          >
            <Trash2 aria-hidden="true" />
            Move to trash
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}

      {pages.isLoading ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square" />
          ))}
        </div>
      ) : pages.error ? (
        <ErrorState error={pages.error} onRetry={() => void pages.refetch()} />
      ) : media.length === 0 ? (
        <EmptyState
          icon={<Images className="size-5" aria-hidden="true" />}
          title="No photos yet"
          description="Add some and they land here, grouped by the day they were taken."
          action={<Button onClick={() => setUploading(true)}>Add photos</Button>}
        />
      ) : (
        <div className="space-y-8">
          {groups.map((group) => (
            <section key={group.key} className="space-y-2">
              <h2 className="text-sm font-semibold text-muted-foreground">{group.label}</h2>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                {group.items.map((item) => (
                  <Thumb
                    key={item.id}
                    media={item}
                    url={urls.data?.[item.id]}
                    selected={selected.has(item.id)}
                    onOpen={() => setOpen(item)}
                    onToggleSelect={() => toggle(item.id)}
                  />
                ))}
              </div>
            </section>
          ))}

          {pages.hasNextPage && (
            <div ref={sentinel} className="flex justify-center py-4">
              {/* The button stays as the fallback. An IntersectionObserver that
                  never fires — a browser without it, a container that does not
                  scroll — must not strand somebody halfway through a library. */}
              <Button
                variant="outline"
                disabled={pages.isFetchingNextPage}
                onClick={() => void pages.fetchNextPage()}
              >
                {pages.isFetchingNextPage ? 'Loading…' : 'Load more'}
              </Button>
            </div>
          )}
        </div>
      )}

      {usage.data && (
        <p className="mt-8 text-xs text-muted-foreground">
          {pluralise(usage.data.photoCount, 'photo')} · {formatBytes(usedBytes)} of{' '}
          {formatBytes(STORAGE_BUDGET_BYTES)} used · room for about{' '}
          {photosRemaining(usedBytes).toLocaleString()} more
        </p>
      )}

      {open && (
        <Lightbox
          media={open}
          neighbours={neighbours}
          onClose={() => setOpen(null)}
          onNavigate={setOpen}
          onShare={() => setSharing(open)}
          onDelete={() => {
            remove.mutate([open.id])
            setOpen(neighbours.next ?? neighbours.previous)
          }}
        />
      )}

      {sharing && (
        <ShareDialog
          target={{ type: 'media', id: sharing.id }}
          onClose={() => setSharing(null)}
        />
      )}
    </div>
  )
}
