/**
 * The line this module must never appear without (spec 10.3, and the same
 * requirement in 4.3 for visas).
 *
 * One component rather than a paragraph copied into six screens: a disclaimer
 * that exists in six places is a disclaimer that will be missing from one of
 * them after the next refactor. It renders the source link and the date the
 * rule was checked alongside, because "advisory" without "as of when" is not
 * much of a warning.
 */
'use client'

import { Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatInZone, parseDateOnly } from '@/lib/dates'

export function AdvisoryNote({
  text,
  sourceUrl,
  verifiedOn,
  className,
}: {
  text: string
  sourceUrl?: string | null
  verifiedOn?: string | null
  className?: string
}) {
  return (
    <p
      className={cn(
        'flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground',
        className,
      )}
    >
      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span>
        {text}
        {verifiedOn && (
          <>
            {' '}
            Checked {formatInZone(parseDateOnly(verifiedOn), 'UTC', 'd MMM yyyy')}.
          </>
        )}
        {sourceUrl && (
          <>
            {' '}
            <a
              href={sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="underline underline-offset-2 hover:text-foreground"
            >
              Source
            </a>
          </>
        )}
      </span>
    </p>
  )
}
