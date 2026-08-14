/**
 * The upload drawer. Spec 11.3.
 *
 * Per-file progress, pause and resume, retry, and a duplicate prompt that
 * always offers "upload anyway" — the spec is explicit that a duplicate is
 * never silently rejected, because two photos of the same view seconds apart
 * are not the same photo and only the person who took them knows that.
 *
 * It also says plainly that originals stay on the device. People assume a
 * photo app uploads the full-resolution file, and here that assumption is
 * wrong in a way worth stating rather than hiding.
 */
'use client'

import { useRef, useState } from 'react'
import { AlertTriangle, Check, ImagePlus, Pause, Play, RotateCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn, pluralise } from '@/lib/utils'
import { isHeic } from '@/lib/images'
import { formatBytes } from '../logic'
import type { UploadQueue } from '../hooks'

export function Uploader({ queue, compact = false }: { queue: UploadQueue; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const { state, summary } = queue

  const pick = (files: FileList | null) => {
    if (!files || files.length === 0) return
    queue.add([...files].filter((file) => file.type.startsWith('image/') || isHeic(file)))
  }

  const slowHeic = state.items.length > 5 && [...state.items].some((i) => /hei[cf]/i.test(i.name))

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          pick(e.dataTransfer.files)
        }}
        className={cn(
          'rounded-lg border border-dashed p-6 text-center transition-colors',
          dragging ? 'border-accent bg-accent/5' : 'border-border',
        )}
      >
        <ImagePlus className="mx-auto size-5 text-muted-foreground" aria-hidden="true" />
        <p className="mt-2 text-sm">Drop photos here, or</p>
        <Button variant="outline" className="mt-2" onClick={() => input.current?.click()}>
          Choose photos
        </Button>
        <input
          ref={input}
          type="file"
          multiple
          accept="image/*,.heic,.heif"
          className="sr-only"
          onChange={(e) => {
            pick(e.target.files)
            e.target.value = ''
          }}
        />
        {!compact && (
          <p className="mx-auto mt-3 max-w-md text-xs text-muted-foreground">
            Photos are resized on your device before upload — a 1600px copy to view and a small
            thumbnail. The full-resolution original stays on your phone, which is what makes the
            free storage tier hold thousands of photos instead of hundreds.
          </p>
        )}
      </div>

      {slowHeic && (
        <p className="text-xs text-muted-foreground">
          Some of these are HEIC. Converting them in the browser is slow — a large batch will take
          a while, and it is faster if you leave this tab in front.
        </p>
      )}

      {state.items.length > 0 && (
        <Card>
          <CardContent className="space-y-3 py-4">
            <div className="flex flex-wrap items-center gap-3">
              <p className="mr-auto text-sm">
                {summary.done} of {summary.total} done
                {summary.failed > 0 && ` · ${summary.failed} failed`}
                {summary.duplicates > 0 && ` · ${summary.duplicates} look familiar`}
              </p>

              {summary.active > 0 &&
                (state.paused ? (
                  <Button variant="ghost" size="sm" onClick={queue.resume}>
                    <Play aria-hidden="true" />
                    Resume
                  </Button>
                ) : (
                  <Button variant="ghost" size="sm" onClick={queue.pause}>
                    <Pause aria-hidden="true" />
                    Pause
                  </Button>
                ))}

              {summary.done > 0 && (
                <Button variant="ghost" size="sm" onClick={queue.clearFinished}>
                  Clear finished
                </Button>
              )}
            </div>

            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-accent transition-[width]"
                style={{ width: `${Math.round(summary.fraction * 100)}%` }}
              />
            </div>

            <ul className="max-h-64 space-y-1.5 overflow-y-auto">
              {state.items.map((item) => (
                <li key={item.id} className="flex items-center gap-3 text-sm">
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  <span className="text-xs text-muted-foreground">{formatBytes(item.bytes)}</span>

                  {item.status === 'done' && (
                    <Check className="size-4 text-[hsl(var(--ok))]" aria-label="Uploaded" />
                  )}

                  {item.status === 'duplicate' && (
                    <>
                      <span className="flex items-center gap-1 text-xs text-[hsl(var(--warn))]">
                        <AlertTriangle className="size-3.5" aria-hidden="true" />
                        Already here?
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => queue.uploadAnyway(item.id)}
                      >
                        Upload anyway
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => queue.remove(item.id)}>
                        Skip
                      </Button>
                    </>
                  )}

                  {item.status === 'failed' && (
                    <>
                      <span className="truncate text-xs text-destructive" title={item.error ?? ''}>
                        {item.error}
                      </span>
                      <Button variant="ghost" size="icon" className="size-7" onClick={() => queue.retry(item.id)}>
                        <RotateCw aria-hidden="true" />
                        <span className="sr-only">Retry {item.name}</span>
                      </Button>
                    </>
                  )}

                  {(item.status === 'processing' || item.status === 'uploading') && (
                    <span className="text-xs text-muted-foreground">
                      {item.status === 'processing' ? 'Resizing…' : 'Uploading…'}
                    </span>
                  )}

                  {item.status === 'pending' && (
                    <span className="text-xs text-muted-foreground">Waiting</span>
                  )}

                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => queue.remove(item.id)}
                  >
                    <X aria-hidden="true" />
                    <span className="sr-only">Remove {item.name} from the queue</span>
                  </Button>
                </li>
              ))}
            </ul>

            {summary.total > 0 && summary.active > 0 && (
              <p className="text-xs text-muted-foreground">
                {pluralise(summary.active, 'photo')} still to go. You can leave this page — the
                queue is remembered, though you will be asked to pick the remaining files again.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
