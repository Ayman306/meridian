/**
 * One square in the grid.
 *
 * The thumbhash matters more than it looks: ~25 bytes decoded to a blurred
 * approximation, rendered before any network request finishes. A grid of grey
 * rectangles that pop into photos feels broken; a grid of blurred colours that
 * sharpen feels like the photos are already there.
 */
'use client'

import { useMemo, useState } from 'react'
import { thumbHashToDataURL } from 'thumbhash'
import { Heart, Play } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Media } from '../types'

export function Thumb({
  media,
  url,
  selected,
  onOpen,
  onToggleSelect,
}: {
  media: Media
  url: string | undefined
  selected?: boolean
  onOpen: () => void
  onToggleSelect?: () => void
}) {
  const placeholder = useThumbhash(media.thumbhash)
  const [loaded, setLoaded] = useState(false)

  return (
    <div className="group relative aspect-square overflow-hidden rounded-md bg-muted">
      <button
        type="button"
        onClick={onOpen}
        className="absolute inset-0 h-full w-full"
        aria-label={media.caption ?? 'Open photo'}
      >
        {placeholder && (
          <img
            src={placeholder}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 size-full object-cover"
          />
        )}
        {url && (
          <img
            src={url}
            alt={media.caption ?? ''}
            loading="lazy"
            decoding="async"
            onLoad={() => setLoaded(true)}
            className={cn(
              'absolute inset-0 size-full object-cover transition-opacity duration-300',
              loaded ? 'opacity-100' : 'opacity-0',
            )}
          />
        )}
      </button>

      {media.media_type === 'video' && (
        <span className="pointer-events-none absolute bottom-1.5 left-1.5 rounded-full bg-black/60 p-1">
          <Play className="size-3 text-white" aria-hidden="true" />
        </span>
      )}

      {media.is_favorite && (
        <span className="pointer-events-none absolute bottom-1.5 right-1.5">
          <Heart className="size-4 fill-white/90 text-white/90 drop-shadow" aria-hidden="true" />
        </span>
      )}

      {onToggleSelect && (
        <label
          className={cn(
            'absolute left-1.5 top-1.5 transition-opacity',
            selected ? 'opacity-100' : 'opacity-0 focus-within:opacity-100 group-hover:opacity-100',
          )}
        >
          <input
            type="checkbox"
            checked={Boolean(selected)}
            onChange={onToggleSelect}
            className="size-4"
            aria-label={`Select ${media.caption ?? 'photo'}`}
          />
        </label>
      )}

      {selected && (
        <span className="pointer-events-none absolute inset-0 rounded-md ring-2 ring-inset ring-accent" />
      )}
    </div>
  )
}

/**
 * Decode once per hash.
 *
 * A `useMemo` rather than state in an effect: decoding twenty-five bytes is
 * cheaper than the render it would trigger, and the result is a pure function
 * of the hash. A malformed one — from a photo uploaded before hashing, or a
 * truncated value — falls back to no placeholder rather than throwing.
 */
export function useThumbhash(hash: string | null): string | null {
  return useMemo(() => {
    if (!hash) return null
    try {
      const binary = atob(hash)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      return thumbHashToDataURL(bytes)
    } catch {
      return null
    }
  }, [hash])
}
