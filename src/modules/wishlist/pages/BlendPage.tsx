/**
 * The blend — five sections, computed rather than declared.
 *
 * "Both of us" is the interesting one: neither of you agreed to anything, you
 * just both saved the same place independently. That coincidence goes first.
 */
'use client'

import { useMemo, useState } from 'react'
import { ArrowRight, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState, ErrorState, SkeletonList } from '@/components/common/states'
import { PersonBadge } from '@/components/PersonBadge'
import { pluralise } from '@/lib/utils'
import { useCouple } from '@/providers/CoupleProvider'
import { planDays, useCategories } from '@/modules/itinerary'
import { useTrip } from '@/modules/trips'
import { chosenDestination, useDestinations } from '@/modules/destinations'
import { SaveCard } from '../components/SaveCard'
import { DraftGenerator } from '../components/DraftGenerator'
import {
  usePushToItinerary,
  useSetVerdict,
  useWishlist,
  useWishlistRealtime,
} from '../hooks'
import { blendCity, buildBlend } from '../logic'
import type { Verdict, WishlistItemWithVerdicts } from '../types'

export function BlendPage({ tripId }: { tripId: string }) {
  const { selfRef, partnerRef } = useCouple()
  const saves = useWishlist()
  const categories = useCategories()
  const { data: trip } = useTrip(tripId)
  const destinations = useDestinations(tripId)
  const setVerdict = useSetVerdict()
  const push = usePushToItinerary(tripId)
  useWishlistRealtime()

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pushNote, setPushNote] = useState<string | null>(null)

  const items = useMemo(() => saves.data ?? [], [saves.data])

  /**
   * Spec 7.6: with no destination chosen, the blend is over everything. With
   * one, it narrows to that city — a save in Tokyo is noise on a Lisbon trip.
   *
   * The trip's chosen destination is what says which city that is. Until the
   * destinations module existed this read the trip's *title*, which worked for
   * "Lisbon in May" and for nothing else; the title match survives as the
   * fallback for a trip nobody has filled a board in for.
   */
  const chosenCity = chosenDestination(destinations.data ?? [])?.city ?? null
  const city = useMemo(
    () => blendCity(chosenCity, trip?.title ?? null, items),
    [chosenCity, trip?.title, items],
  )
  const scoped = useMemo(
    () => (city ? items.filter((i) => !i.city || i.city === city) : items),
    [items, city],
  )

  const blend = useMemo(
    () => buildBlend(scoped, selfRef?.id ?? '', partnerRef?.id ?? null),
    [scoped, selfRef?.id, partnerRef?.id],
  )

  const days = useMemo(
    () => planDays(trip?.start_date ?? null, trip?.end_date ?? null),
    [trip?.start_date, trip?.end_date],
  )

  if (saves.isLoading) return <SkeletonList rows={4} />
  if (saves.error) return <ErrorState error={saves.error} onRetry={() => void saves.refetch()} />

  const categoryName = (id: string | null) =>
    (categories.data ?? []).find((c) => c.id === id)?.name ?? null

  const verdictOf = (item: WishlistItemWithVerdicts, userId: string | undefined) =>
    (item.verdicts.find((v) => v.user_id === userId)?.verdict as Verdict | undefined) ?? null

  const card = (item: WishlistItemWithVerdicts, selectable = false) => (
    <SaveCard
      key={item.id}
      item={item}
      owner={item.user_id === selfRef?.id ? selfRef : partnerRef}
      isMine={item.user_id === selfRef?.id}
      myVerdict={verdictOf(item, selfRef?.id)}
      partnerVerdict={verdictOf(item, partnerRef?.id)}
      partnerName={partnerRef?.displayName ?? 'They'}
      categoryName={categoryName(item.category_id)}
      selected={selectable ? selected.has(item.id) : undefined}
      onToggleSelect={
        selectable
          ? () =>
              setSelected((prev) => {
                const next = new Set(prev)
                if (next.has(item.id)) next.delete(item.id)
                else next.add(item.id)
                return next
              })
          : undefined
      }
      onSetVerdict={(verdict) => setVerdict.mutate({ id: item.id, verdict })}
    />
  )

  const pushSelected = (ids: string[]) => {
    if (ids.length === 0) return
    push.mutate({ itemIds: ids }, {
      onSuccess: ({ pushed, skipped }) => {
        setSelected(new Set())
        setPushNote(
          skipped.length === 0
            ? `${pluralise(pushed.length, 'place')} added to the idea pool.`
            : // Spec 7.6: pushing twice is worth a warning, not a duplicate.
              `${pluralise(pushed.length, 'place')} added. ${skipped.length} ${
                skipped.length === 1 ? 'was' : 'were'
              } already in the pool.`,
        )
      },
    })
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Users className="size-5" aria-hidden="true" />}
        title="Nothing to blend yet"
        description="Once you have both saved a few places, this is where the overlap shows up."
      />
    )
  }

  return (
    <div className="space-y-8">
      {pushNote && (
        <Card>
          <CardContent className="flex items-center gap-3 py-3 text-sm">
            <span className="mr-auto">{pushNote}</span>
            <Button variant="ghost" size="sm" onClick={() => setPushNote(null)}>
              Dismiss
            </Button>
          </CardContent>
        </Card>
      )}

      {city && (
        <p className="text-xs text-muted-foreground">
          Showing saves in {city} and saves with no city yet.
        </p>
      )}

      {/* Both of us — hidden entirely when only one of you has saved anything,
          rather than shown as an empty section (spec 7.6). */}
      {blend.both.length > 0 && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="mr-auto text-sm font-semibold">
              Both of you
              <span className="ml-2 font-normal text-muted-foreground">{blend.both.length}</span>
            </h2>
            <Button
              variant="outline"
              size="sm"
              disabled={push.isPending}
              onClick={() => pushSelected(blend.both.map((pair) => pair.items[0]!.id))}
            >
              <ArrowRight aria-hidden="true" />
              Push all to the plan
            </Button>
          </div>

          <div className="space-y-3">
            {blend.both.map((pair) => (
              <div key={pair.items[0]!.id} className="space-y-1">
                {card(pair.items[0]!, true)}
                <p className="pl-4 text-xs text-muted-foreground">
                  {pair.matchedBy === 'proximity'
                    ? 'Matched by location — within 150 m of each other'
                    : 'Matched by name, in the same city'}
                  {' · '}
                  saved by
                  <PersonBadge person={selfRef} size="xs" className="mx-1 align-middle" />
                  and
                  <PersonBadge person={partnerRef} size="xs" className="mx-1 align-middle" />
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {selected.size > 0 && (
        <div className="sticky bottom-16 z-10 flex items-center gap-3 rounded-lg border border-border bg-background/95 p-3 shadow-lg backdrop-blur md:bottom-4">
          <span className="text-sm">{pluralise(selected.size, 'place')} selected</span>
          <Button size="sm" disabled={push.isPending} onClick={() => pushSelected([...selected])}>
            Push to the plan
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}

      {/* Push-all is offered where "all of these" is one coherent decision:
          everything you picked, everything they picked, everything nobody has
          voted on. It is *not* offered on Clashes — pushing a place the other
          person said no to is precisely the thing that needs a per-item choice,
          and a bulk button there would make disagreement a single tap. */}
      <Section
        title="Your picks"
        items={blend.mine}
        render={(i) => card(i, true)}
        onPushAll={pushSelected}
        pushing={push.isPending}
      />
      <Section
        title={`${partnerRef?.displayName ?? 'Their'} picks`}
        items={blend.theirs}
        render={(i) => card(i, true)}
        onPushAll={pushSelected}
        pushing={push.isPending}
      />
      <Section
        title="Undecided"
        hint="Their saves you have not voted on. Leaving them is fine."
        items={blend.undecided}
        render={(i) => card(i)}
        onPushAll={pushSelected}
        pushing={push.isPending}
      />
      <Section
        title="Clashes"
        hint="One of you said no. They stay here rather than disappearing — knowing you disagree is the useful part."
        items={blend.clashes}
        render={(i) => card(i)}
      />

      {selfRef && (
        <DraftGenerator
          tripId={tripId}
          items={scoped}
          days={days}
          selfId={selfRef.id}
          partnerId={partnerRef?.id ?? null}
        />
      )}
    </div>
  )
}

function Section({
  title,
  hint,
  items,
  render,
  onPushAll,
  pushing,
}: {
  title: string
  hint?: string
  items: WishlistItemWithVerdicts[]
  render: (item: WishlistItemWithVerdicts) => React.ReactNode
  /** Set on sections where pushing the lot is a sensible single decision. */
  onPushAll?: (ids: string[]) => void
  pushing?: boolean
}) {
  if (items.length === 0) return null
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h2 className="text-sm font-semibold">
            {title}
            <span className="ml-2 font-normal text-muted-foreground">{items.length}</span>
          </h2>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
        {onPushAll && (
          <Button
            variant="outline"
            size="sm"
            disabled={pushing}
            onClick={() => onPushAll(items.map((item) => item.id))}
          >
            <ArrowRight aria-hidden="true" />
            Push all {items.length}
          </Button>
        )}
      </div>
      <div className="space-y-3">{items.map(render)}</div>
    </section>
  )
}


