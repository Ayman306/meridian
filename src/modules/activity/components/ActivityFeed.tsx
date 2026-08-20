/**
 * What they did while you were asleep.
 *
 * The premise of the whole app is two people in two time zones, and until now
 * there was no way to see what the other one had been doing for the eight hours
 * you were not there. You woke up, they had been planning, and the only way to
 * find out was to notice a difference on a screen you happened to open.
 *
 * ## Their changes, not yours
 *
 * Your own edits echoed back are noise — you were there. So the card leads with
 * theirs, and yours are behind a disclosure for the "did that save?" moment.
 * The database returns both, because the same query answers "what has happened
 * lately" for an assistant, where excluding the caller would be wrong.
 *
 * ## Marking it read does not empty it
 *
 * A card that goes blank the moment you look at it is a card that teaches you
 * not to look. It fetches a fortnight and bolds what is new, so "seen" moves a
 * line rather than deleting history.
 */
'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  BedDouble,
  CalendarRange,
  Check,
  FileText,
  Heart,
  Image as ImageIcon,
  MapPin,
  Plane,
  ThumbsUp,
  Wallet,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { SkeletonList } from '@/components/common/states'
import { useCouple } from '@/providers/CoupleProvider'
import { useAuth } from '@/providers/AuthProvider'
import { pluralise } from '@/lib/utils'
import { useActivity, useActivitySeenAt, useMarkActivitySeen } from '../hooks'
import { countUnseen, describeActivity, hrefForActivity, isUnseen } from '../logic'
import type { Activity, ActivityEvent } from '../types'

const ICONS: Record<ActivityEvent, typeof Heart> = {
  trip_created: CalendarRange,
  plan_added: CalendarRange,
  place_saved: Heart,
  verdict_cast: ThumbsUp,
  stay_booked: BedDouble,
  destination_added: MapPin,
  flight_added: Plane,
  expense_logged: Wallet,
  photo_added: ImageIcon,
  document_added: FileText,
}

export function ActivityFeed() {
  const { user } = useAuth()
  const { selfRef, partnerRef } = useCouple()
  const activity = useActivity()
  const seenAt = useActivitySeenAt()
  const markSeen = useMarkActivitySeen()
  const [showMine, setShowMine] = useState(false)

  if (activity.isLoading) return <SkeletonList rows={2} />

  const all = activity.data ?? []
  const theirs = all.filter((a) => a.actorId !== user?.id)
  const mine = all.filter((a) => a.actorId === user?.id)
  const unseen = countUnseen(theirs, seenAt)

  // Nothing at all is the common case for a couple who both just looked. A card
  // that says "no activity" every morning is one people stop reading, so it
  // renders nothing rather than an empty state.
  if (theirs.length === 0 && mine.length === 0) return null

  const nameFor = (actorId: string | null) =>
    actorId === user?.id
      ? (selfRef?.displayName ?? 'You')
      : actorId === partnerRef?.id
        ? partnerRef.displayName
        : null

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">
          {unseen > 0
            ? `${pluralise(unseen, 'thing')} since you last looked`
            : 'Recently, between you'}
        </h2>
        {unseen > 0 && (
          <Button
            size="sm"
            variant="ghost"
            disabled={markSeen.isPending}
            onClick={() => markSeen.mutate()}
          >
            <Check aria-hidden="true" />
            Mark seen
          </Button>
        )}
      </div>

      {theirs.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing from {partnerRef?.displayName ?? 'them'} lately.
        </p>
      ) : (
        <ul className="space-y-1">
          {theirs.slice(0, 8).map((item) => (
            <Row
              key={`${item.event}-${item.id}`}
              activity={item}
              name={nameFor(item.actorId)}
              isNew={isUnseen(item, seenAt)}
            />
          ))}
        </ul>
      )}

      {mine.length > 0 && (
        <div className="border-t border-border pt-2">
          <button
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            aria-expanded={showMine}
            onClick={() => setShowMine((v) => !v)}
          >
            {showMine ? 'Hide' : 'Show'} {pluralise(mine.length, 'thing')} you added
          </button>
          {showMine && (
            <ul className="mt-2 space-y-1">
              {mine.slice(0, 8).map((item) => (
                <Row
                  key={`${item.event}-${item.id}`}
                  activity={item}
                  name={nameFor(item.actorId)}
                  isNew={false}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  )
}

function Row({
  activity,
  name,
  isNew,
}: {
  activity: Activity
  name: string | null
  isNew: boolean
}) {
  const Icon = ICONS[activity.event]

  return (
    <li>
      <Link
        href={hrefForActivity(activity)}
        className="flex items-start gap-2 rounded-md px-1 py-1 text-sm hover:bg-secondary/60"
      >
        {/* The unread mark is a dot rather than bold text: bold reflows the row
            when it clears, and a list that shifts as you read it is worse than
            one that does not tell you quite as loudly. */}
        <span
          aria-hidden="true"
          className={
            isNew ? 'mt-1.5 size-1.5 shrink-0 rounded-full bg-accent' : 'mt-1.5 size-1.5 shrink-0'
          }
        />
        <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="text-muted-foreground">{describeActivity(activity, name)}: </span>
          <span>{activity.title}</span>
          {activity.subtitle && (
            <span className="text-muted-foreground"> · {activity.subtitle}</span>
          )}
          {isNew && <span className="sr-only"> (new)</span>}
        </span>
      </Link>
    </li>
  )
}
