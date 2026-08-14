/**
 * Albums. Spec 11.3.
 *
 * One per trip, created automatically, plus whatever manual ones the two of
 * them want. A photo can be in several — the many-to-many is the point, since
 * "the good ones" and "the trip" overlap heavily and neither is a copy.
 */
'use client'

import { useMemo, useState } from 'react'
import { FolderPlus, Images } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState, ErrorState, SkeletonList } from '@/components/common/states'
import { pluralise } from '@/lib/utils'
import { Thumb } from '../components/Thumb'
import { useAlbumMedia, useAlbums, useCreateAlbum, useMediaUrls } from '../hooks'

export function AlbumsPage() {
  const albums = useAlbums()
  const create = useCreateAlbum()
  const [title, setTitle] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  const open = albums.data?.find((a) => a.id === openId) ?? null

  return (
    <div>
      <PageHeader title="Albums" description="Trip albums make themselves. The rest are yours." />

      <Card className="mb-6">
        <CardContent className="flex flex-wrap items-end gap-2 py-4">
          <label className="text-xs text-muted-foreground">
            New album
            <Input
              className="mt-1 w-56"
              value={title}
              placeholder="The good ones"
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <Button
            disabled={!title.trim() || create.isPending}
            onClick={() => create.mutate(title.trim(), { onSuccess: () => setTitle('') })}
          >
            <FolderPlus aria-hidden="true" />
            Create
          </Button>
        </CardContent>
      </Card>

      {albums.isLoading ? (
        <SkeletonList rows={3} />
      ) : albums.error ? (
        <ErrorState error={albums.error} onRetry={() => void albums.refetch()} />
      ) : (albums.data ?? []).length === 0 ? (
        <EmptyState
          icon={<Images className="size-5" aria-hidden="true" />}
          title="No albums yet"
          description="A trip album appears as soon as a trip has photos in it."
        />
      ) : (
        <div className="space-y-3">
          {albums.data!.map((album) => (
            <button
              key={album.id}
              onClick={() => setOpenId(openId === album.id ? null : album.id)}
              aria-expanded={openId === album.id}
              className="flex w-full items-center gap-3 rounded-lg border border-border p-4 text-left hover:bg-secondary/40"
            >
              <span className="font-medium">{album.title}</span>
              {album.kind === 'trip' && (
                <span className="rounded-full bg-secondary px-2 py-0.5 text-xs">Trip</span>
              )}
            </button>
          ))}
        </div>
      )}

      {open && <AlbumContents albumId={open.id} />}
    </div>
  )
}

function AlbumContents({ albumId }: { albumId: string }) {
  const media = useAlbumMedia(albumId)
  const items = useMemo(() => media.data ?? [], [media.data])
  const urls = useMediaUrls(items, 'thumb')

  if (items.length === 0) {
    return <EmptyState title="This album is empty" subtle className="mt-4" />
  }

  return (
    <div className="mt-4 space-y-2">
      <p className="text-xs text-muted-foreground">{pluralise(items.length, 'photo')}</p>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {items.map((item) => (
          <Thumb key={item.id} media={item} url={urls.data?.[item.id]} onOpen={() => {}} />
        ))}
      </div>
    </div>
  )
}
