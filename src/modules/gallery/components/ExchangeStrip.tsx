/**
 * One photo each, every day.
 *
 * The table, the RPC and the hooks have existed since Phase 11 with no surface,
 * so the feature was reachable only by someone reading the schema. It is the
 * one part of the gallery that is about the days *between* trips, which is most
 * of the days.
 *
 * Deliberately small: a strip at the top of the gallery rather than a page of
 * its own. It is a habit, and a habit that needs navigating to is a habit that
 * stops.
 */
'use client'

import { useMemo, useState } from 'react'
import { CalendarHeart } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { addDaysTo, formatDateOnly, todayIn, type DateOnly } from '@/lib/dates'
import { useCouple } from '@/providers/CoupleProvider'
import { useAuth } from '@/providers/AuthProvider'
import { useExchange, useMediaUrls, useMediaPages, usePostExchange } from '../hooks'

/** Two weeks back. Far enough to see a streak, short enough to stay a strip. */
const WINDOW_DAYS = 14

export function ExchangeStrip() {
  const { tzSelf, selfRef, partnerRef } = useCouple()
  const { user } = useAuth()
  const today = todayIn(tzSelf)
  const since = addDaysTo(today, -WINDOW_DAYS)

  const exchange = useExchange(since)
  const post = usePostExchange()
  const [picking, setPicking] = useState(false)

  const rows = exchange.data ?? []
  const mine = rows.filter((row) => row.user_id === user?.id)
  const theirs = rows.filter((row) => row.user_id !== user?.id)
  const postedToday = mine.some((row) => row.exchange_date === today)

  // Only loaded when the picker opens. Nobody should pay for a page of photos
  // to look at a strip.
  const recent = useMediaPages(picking ? { mediaType: 'photo' } : {})
  const options = picking ? (recent.data?.pages[0]?.items ?? []) : []
  const optionUrls = useMediaUrls(options, 'thumb').data ?? {}

  const days = useMemo(
    () => Array.from({ length: WINDOW_DAYS }, (_, i) => addDaysTo(today, -i)),
    [today],
  )

  if (exchange.isLoading) return null

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <CalendarHeart className="size-4" aria-hidden="true" />
          A photo a day
        </h2>
        {!postedToday && (
          <Button size="sm" variant="outline" onClick={() => setPicking((v) => !v)}>
            {picking ? 'Close' : "Post today's"}
          </Button>
        )}
      </div>

      {/* Two rows, one per person, so a gap is visible as a gap. A merged
          timeline would hide which of them missed a day, which is the only
          thing the strip is really for. */}
      <div className="space-y-1.5">
        <PersonRow
          label={selfRef?.displayName ?? 'You'}
          days={days}
          posted={new Set(mine.map((r) => r.exchange_date))}
        />
        {partnerRef && (
          <PersonRow
            label={partnerRef.displayName}
            days={days}
            posted={new Set(theirs.map((r) => r.exchange_date))}
          />
        )}
      </div>

      {picking && (
        <div className="grid max-h-40 grid-cols-5 gap-2 overflow-y-auto rounded-md border border-border p-2 sm:grid-cols-8">
          {options.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-label={`Post ${item.caption ?? 'this photo'} as today's`}
              className="aspect-square overflow-hidden rounded bg-muted hover:opacity-80"
              onClick={() => {
                post.mutate({ mediaId: item.id, exchangeDate: today })
                setPicking(false)
              }}
            >
              {optionUrls[item.id] && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={optionUrls[item.id]} alt="" className="size-full object-cover" />
              )}
            </button>
          ))}
        </div>
      )}
    </Card>
  )
}

function PersonRow({
  label,
  days,
  posted,
}: {
  label: string
  days: DateOnly[]
  posted: ReadonlySet<string>
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 truncate text-xs text-muted-foreground">{label}</span>
      <div className="flex gap-1">
        {/* Oldest on the left, so the strip reads forward like everything else. */}
        {[...days].reverse().map((date) => (
          <span
            key={date}
            title={`${label} · ${formatDateOnly(date, 'd MMM')}`}
            aria-label={`${label}, ${formatDateOnly(date, 'd MMMM')}: ${
              posted.has(date) ? 'posted' : 'nothing'
            }`}
            className={
              posted.has(date)
                ? 'size-3 rounded-sm bg-accent'
                : 'size-3 rounded-sm bg-secondary'
            }
          />
        ))}
      </div>
    </div>
  )
}
