/**
 * The receipt attached to an expense.
 *
 * `receipt_media_id` has existed since Phase 12 and nothing has ever set it,
 * so a photo of the bill could sit in the gallery next to the expense it was
 * proof of and never be joined to it.
 *
 * It picks from photos already uploaded rather than uploading here. The upload
 * pipeline — EXIF stripping, derivatives, the thumbhash, the storage quota —
 * lives in the gallery module, and a second entry point into it would drift
 * from the first. The trip filter does most of the work: the bill is almost
 * always among the last few things photographed on that trip.
 */
'use client'

import { useState } from 'react'
import { Receipt, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/common/states'
import { useMediaPages, useMediaUrls } from '@/modules/gallery'

export function ReceiptPicker({
  tripId,
  value,
  onChange,
}: {
  tripId: string | null
  value: string | null
  onChange: (id: string | null) => void
}) {
  const [open, setOpen] = useState(false)

  // Only fetched once somebody opens the picker. A form that quietly loads a
  // page of photos every time it renders is a form that costs bandwidth to
  // look at.
  const pages = useMediaPages(open ? { tripId, mediaType: 'photo' } : {})
  const items = open ? (pages.data?.pages.flatMap((page) => page.items) ?? []) : []
  const urls = useMediaUrls(items, 'thumb').data ?? {}

  const chosen = items.find((item) => item.id === value)

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Receipt</span>
        {value ? (
          <>
            <span className="text-xs text-muted-foreground">
              {chosen?.caption ?? 'A photo is attached'}
            </span>
            <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)}>
              <X aria-hidden="true" />
              Remove
            </Button>
          </>
        ) : (
          <Button type="button" size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
            <Receipt aria-hidden="true" />
            {open ? 'Close' : 'Attach a photo'}
          </Button>
        )}
      </div>

      {open && !value && (
        <div className="rounded-lg border border-border p-2">
          {pages.isLoading ? (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="aspect-square animate-pulse rounded-md bg-muted" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              subtle
              title="No photos on this trip yet"
              description="Upload the bill in the gallery and it can be attached here."
            />
          ) : (
            <div className="grid max-h-48 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6">
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-label={`Use ${item.caption ?? 'this photo'} as the receipt`}
                  className="aspect-square overflow-hidden rounded-md border border-transparent bg-muted hover:border-accent"
                  onClick={() => {
                    onChange(item.id)
                    setOpen(false)
                  }}
                >
                  {urls[item.id] && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={urls[item.id]}
                      alt={item.caption ?? ''}
                      className="size-full object-cover"
                    />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
