/**
 * One photo, large. Spec 11.3.
 *
 * Loads the display variant and nothing else — the grid already paid for the
 * thumb and the original does not exist. Preloads at most one neighbour in
 * each direction, which is the egress budget from spec 11.4: enough that
 * arrowing through feels instant, not so much that opening one photo fetches
 * a page of them.
 */
'use client'

import { useEffect, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Heart,
  MapPin,
  MessageSquare,
  Share2,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PersonBadge } from '@/components/PersonBadge'
import { formatInZone } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { useCouple } from '@/providers/CoupleProvider'
import { useThumbhash } from './Thumb'
import { useAddComment, useComments, useMediaUrl, useUpdateMedia } from '../hooks'
import { momentOf } from '../logic'
import type { Media } from '../types'

export function Lightbox({
  media,
  neighbours,
  onClose,
  onNavigate,
  onDelete,
  onShare,
}: {
  media: Media
  neighbours: { previous: Media | null; next: Media | null }
  onClose: () => void
  onNavigate: (media: Media) => void
  onDelete: () => void
  onShare: () => void
}) {
  const { selfRef, partnerRef, tzSelf } = useCouple()
  const current = useMediaUrl(media, 'display')
  // At most one each way. Both are ordinary queries, so the browser caches
  // them and arrowing across is instant without a manual preload cache.
  useMediaUrl(neighbours.previous ?? undefined, 'display')
  useMediaUrl(neighbours.next ?? undefined, 'display')

  const placeholder = useThumbhash(media.thumbhash)
  const update = useUpdateMedia()
  const comments = useComments(media.id)
  const addComment = useAddComment(media.id)

  const [showComments, setShowComments] = useState(false)
  const [draft, setDraft] = useState('')
  const touchStart = useRef<number | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft' && neighbours.previous) onNavigate(neighbours.previous)
      if (e.key === 'ArrowRight' && neighbours.next) onNavigate(neighbours.next)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [neighbours, onClose, onNavigate])

  const uploader = media.uploader_id === selfRef?.id ? selfRef : partnerRef

  const download = async () => {
    if (!current.data) return
    // Fetched as a blob so the filename is ours rather than a signed-URL query
    // string, and so a same-origin download does not navigate away.
    const response = await fetch(current.data)
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${media.id}.jpg`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-background/98 backdrop-blur"
      role="dialog"
      aria-modal="true"
      aria-label={media.caption ?? 'Photo'}
    >
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <PersonBadge person={uploader} size="xs" />
        <span className="text-sm text-muted-foreground">
          {formatInZone(momentOf(media), tzSelf, 'EEE d MMM yyyy, HH:mm')}
        </span>
        {media.lat !== null && (
          <MapPin className="size-3.5 text-muted-foreground" aria-label="Has a location" />
        )}

        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={media.is_favorite ? 'Remove from favourites' : 'Add to favourites'}
            aria-pressed={media.is_favorite}
            onClick={() => update.mutate({ id: media.id, patch: { is_favorite: !media.is_favorite } })}
          >
            <Heart className={cn(media.is_favorite && 'fill-current text-accent')} aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Comments"
            aria-pressed={showComments}
            onClick={() => setShowComments(!showComments)}
          >
            <MessageSquare aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Share" onClick={onShare}>
            <Share2 aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Download" onClick={() => void download()}>
            <Download aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Move to trash" onClick={onDelete}>
            <Trash2 aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
            <X aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div
        className="relative flex flex-1 items-center justify-center overflow-hidden"
        onTouchStart={(e) => (touchStart.current = e.touches[0]?.clientX ?? null)}
        onTouchEnd={(e) => {
          const start = touchStart.current
          const end = e.changedTouches[0]?.clientX
          touchStart.current = null
          if (start === null || end === undefined) return
          const delta = end - start
          if (Math.abs(delta) < 60) return
          if (delta > 0 && neighbours.previous) onNavigate(neighbours.previous)
          if (delta < 0 && neighbours.next) onNavigate(neighbours.next)
        }}
      >
        {placeholder && !current.data && (
          <img src={placeholder} alt="" aria-hidden="true" className="max-h-full max-w-full blur-xl" />
        )}
        {current.data &&
          (media.media_type === 'video' ? (
            // `controls` and nothing else: no autoplay, because a video that
            // starts talking when somebody opens a photo album is startling,
            // and no loop, because this is a memory rather than a GIF.
            <video
              src={current.data}
              controls
              playsInline
              preload="metadata"
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <img
              src={current.data}
              alt={media.caption ?? ''}
              className="max-h-full max-w-full object-contain"
            />
          ))}

        {neighbours.previous && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous photo"
            className="absolute left-2 top-1/2 -translate-y-1/2 bg-background/70"
            onClick={() => onNavigate(neighbours.previous!)}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
        )}
        {neighbours.next && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next photo"
            className="absolute right-2 top-1/2 -translate-y-1/2 bg-background/70"
            onClick={() => onNavigate(neighbours.next!)}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        )}
      </div>

      <div className="space-y-3 border-t border-border px-4 py-3">
        {/* Uncontrolled and keyed by photo: mirroring the caption into state
            would mean writing to state from an effect every time the lightbox
            moved to the next image. The key resets the field instead. */}
        <Input
          key={media.id}
          defaultValue={media.caption ?? ''}
          placeholder="Add a caption"
          aria-label="Caption"
          onBlur={(e) => {
            const trimmed = e.target.value.trim()
            if (trimmed !== (media.caption ?? '')) {
              update.mutate({ id: media.id, patch: { caption: trimmed || null } })
            }
          }}
        />

        {showComments && (
          <div className="space-y-2">
            {comments.data?.map((comment) => (
              <div key={comment.id} className="flex items-start gap-2 text-sm">
                <PersonBadge
                  person={comment.author_id === selfRef?.id ? selfRef : partnerRef}
                  size="xs"
                />
                <span>{comment.body}</span>
              </div>
            ))}
            {comments.data?.length === 0 && (
              <p className="text-xs text-muted-foreground">Nothing said about this one yet.</p>
            )}
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                const body = draft.trim()
                if (!body) return
                addComment.mutate(body, { onSuccess: () => setDraft('') })
              }}
            >
              <Input
                value={draft}
                placeholder="Say something"
                aria-label="Add a comment"
                onChange={(e) => setDraft(e.target.value)}
              />
              <Button type="submit" variant="outline" disabled={!draft.trim()}>
                Send
              </Button>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}
