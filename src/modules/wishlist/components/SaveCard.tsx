'use client'

import { ExternalLink, MapPin, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PersonBadge } from '@/components/PersonBadge'
import { cn } from '@/lib/utils'
import { googleMapsUrl } from '@/modules/map'
import type { PersonRef } from '@/types/domain'
import { VerdictButtons } from './VerdictButtons'
import type { Verdict, WishlistItemWithVerdicts } from '../types'

export function SaveCard({
  item,
  owner,
  isMine,
  myVerdict,
  partnerVerdict,
  partnerName,
  categoryName,
  selected,
  onToggleSelect,
  onSetVerdict,
  onEdit,
  onDelete,
}: {
  item: WishlistItemWithVerdicts
  owner: PersonRef | null
  isMine: boolean
  myVerdict: Verdict | null
  partnerVerdict: Verdict | null
  partnerName: string
  categoryName: string | null
  selected?: boolean
  onToggleSelect?: () => void
  onSetVerdict?: (verdict: Verdict | null) => void
  onEdit?: () => void
  onDelete?: () => void
}) {
  return (
    <div
      className={cn(
        'rounded-lg border border-border p-4 transition-colors',
        selected && 'border-accent bg-accent/5',
      )}
    >
      <div className="flex items-start gap-3">
        {onToggleSelect && (
          <input
            type="checkbox"
            checked={Boolean(selected)}
            onChange={onToggleSelect}
            className="mt-1 size-4"
            aria-label={`Select ${item.title}`}
          />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <p className="min-w-0 flex-1 font-medium leading-snug">{item.title}</p>
            <PersonBadge person={owner} size="xs" />
          </div>

          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {item.city && <span>{item.city}</span>}
            {categoryName && <span>· {categoryName}</span>}
            {item.intensity !== null && (
              <span aria-label={`Intensity ${item.intensity} of 5`}>
                · {'★'.repeat(item.intensity)}
                <span className="text-muted-foreground/40">{'★'.repeat(5 - item.intensity)}</span>
              </span>
            )}
          </p>

          {item.notes && <p className="mt-2 text-sm text-muted-foreground">{item.notes}</p>}

          <div className="mt-3 flex flex-wrap items-center gap-3">
            {/* Their verdict, when it exists, next to yours — the point of the
                screen is seeing what the other one thought. */}
            {isMine ? (
              <p className="text-xs text-muted-foreground">
                {partnerVerdict
                  ? `${partnerName}: ${partnerVerdict}`
                  : `${partnerName} hasn't said yet`}
              </p>
            ) : (
              onSetVerdict && <VerdictButtons current={myVerdict} onSet={onSetVerdict} />
            )}

            <div className="ml-auto flex items-center gap-1">
              {item.url && (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="rounded p-1.5 text-muted-foreground hover:text-foreground"
                  title="Open the link"
                >
                  <ExternalLink className="size-4" aria-hidden="true" />
                  <span className="sr-only">Open the original link</span>
                </a>
              )}
              {item.lat !== null && item.lng !== null && (
                <a
                  href={googleMapsUrl({
                    title: item.title,
                    placeName: item.place_name,
                    lat: Number(item.lat),
                    lng: Number(item.lng),
                  })}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="rounded p-1.5 text-muted-foreground hover:text-foreground"
                  title="Open in Google Maps"
                >
                  <MapPin className="size-4" aria-hidden="true" />
                  <span className="sr-only">Open in Google Maps</span>
                </a>
              )}
              {/* Only your own saves are yours to change — the database says so
                  too, so hiding these is honesty rather than decoration. */}
              {isMine && onEdit && (
                <Button variant="ghost" size="icon" className="size-8" onClick={onEdit}>
                  <Pencil aria-hidden="true" />
                  <span className="sr-only">Edit {item.title}</span>
                </Button>
              )}
              {isMine && onDelete && (
                <Button variant="ghost" size="icon" className="size-8" onClick={onDelete}>
                  <Trash2 aria-hidden="true" />
                  <span className="sr-only">Remove {item.title}</span>
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
