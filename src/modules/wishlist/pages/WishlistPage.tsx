/**
 * Everything either of you has saved, grouped by city.
 *
 * This is the list; `/trips/:id/blend` is the view that compares the two. The
 * separation matters: saving should never feel like voting.
 */
'use client'

import { useMemo, useState } from 'react'
import { Heart, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select } from '@/components/ui/input'
import { PageHeader } from '@/components/layout/PageHeader'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { EmptyState, ErrorState, SkeletonList } from '@/components/common/states'
import { pluralise } from '@/lib/utils'
import { useCouple } from '@/providers/CoupleProvider'
import { useCategories } from '@/modules/itinerary'
import { SaveCard } from '../components/SaveCard'
import { WishlistForm } from '../components/WishlistForm'
import {
  useDeleteWishlistItem,
  useSetVerdict,
  useWishlist,
  useWishlistRealtime,
} from '../hooks'
import { groupByCity } from '../logic'
import type { WishlistItemWithVerdicts } from '../types'

export function WishlistPage() {
  const { selfRef, partnerRef } = useCouple()
  const saves = useWishlist()
  const categories = useCategories()
  const setVerdict = useSetVerdict()
  const remove = useDeleteWishlistItem()
  useWishlistRealtime()

  const [editing, setEditing] = useState<WishlistItemWithVerdicts | null | undefined>(undefined)
  const [confirming, setConfirming] = useState<WishlistItemWithVerdicts | null>(null)
  const [person, setPerson] = useState('')
  const [category, setCategory] = useState('')

  const items = useMemo(() => saves.data ?? [], [saves.data])
  const filtered = useMemo(
    () =>
      items.filter(
        (item) =>
          (!person || item.user_id === person) && (!category || item.category_id === category),
      ),
    [items, person, category],
  )
  const byCity = useMemo(() => groupByCity(filtered), [filtered])
  const cityNames = useMemo(
    // "Unfiled" last: it is a holding pen, not a place.
    () => Object.keys(byCity).sort((a, b) => (a === 'Unfiled' ? 1 : b === 'Unfiled' ? -1 : a.localeCompare(b))),
    [byCity],
  )

  const categoryName = (id: string | null) =>
    (categories.data ?? []).find((c) => c.id === id)?.name ?? null

  return (
    <div>
      <PageHeader
        title="Wishlist"
        description="Save places as you find them. Nobody has to agree yet."
        actions={
          editing === undefined ? (
            <Button onClick={() => setEditing(null)}>
              <Plus aria-hidden="true" />
              Save a place
            </Button>
          ) : null
        }
      />

      {editing !== undefined && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">{editing ? 'Edit save' : 'Save a place'}</CardTitle>
          </CardHeader>
          <CardContent>
            <WishlistForm
              item={editing}
              categories={categories.data ?? []}
              onClose={() => setEditing(undefined)}
            />
          </CardContent>
        </Card>
      )}

      {saves.isLoading ? (
        <SkeletonList rows={4} />
      ) : saves.error ? (
        <ErrorState error={saves.error} onRetry={() => void saves.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Heart className="size-5" aria-hidden="true" />}
          title="Nothing saved yet"
          description="Paste a link to a place either of you likes the look of. A city is optional — save it before you know where you're going."
          action={<Button onClick={() => setEditing(null)}>Save the first one</Button>}
        />
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            {partnerRef && (
              <label className="text-xs text-muted-foreground">
                Whose
                <Select
                  className="mt-1 h-9 w-auto"
                  value={person}
                  onChange={(e) => setPerson(e.target.value)}
                >
                  <option value="">Both of you</option>
                  {selfRef && <option value={selfRef.id}>You</option>}
                  <option value={partnerRef.id}>{partnerRef.displayName}</option>
                </Select>
              </label>
            )}
            <label className="text-xs text-muted-foreground">
              Category
              <Select
                className="mt-1 h-9 w-auto"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">Everything</option>
                {(categories.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </label>
            <p className="ml-auto text-xs text-muted-foreground">
              {pluralise(filtered.length, 'save')}
            </p>
          </div>

          {filtered.length === 0 ? (
            <EmptyState title="Nothing matches that filter" subtle />
          ) : (
            cityNames.map((city) => (
              <section key={city} className="space-y-3">
                <h2 className="text-sm font-semibold text-muted-foreground">
                  {city}
                  <span className="ml-2 font-normal">{byCity[city]!.length}</span>
                </h2>
                <div className="space-y-3">
                  {byCity[city]!.map((item) => (
                    <SaveCard
                      key={item.id}
                      item={item}
                      owner={item.user_id === selfRef?.id ? selfRef : partnerRef}
                      isMine={item.user_id === selfRef?.id}
                      myVerdict={
                        (item.verdicts.find((v) => v.user_id === selfRef?.id)?.verdict as
                          | 'yes'
                          | 'no'
                          | 'maybe'
                          | undefined) ?? null
                      }
                      partnerVerdict={
                        (item.verdicts.find((v) => v.user_id === partnerRef?.id)?.verdict as
                          | 'yes'
                          | 'no'
                          | 'maybe'
                          | undefined) ?? null
                      }
                      partnerName={partnerRef?.displayName ?? 'They'}
                      categoryName={categoryName(item.category_id)}
                      onSetVerdict={(verdict) => setVerdict.mutate({ id: item.id, verdict })}
                      onEdit={() => setEditing(item)}
                      onDelete={() => setConfirming(item)}
                    />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirming !== null}
        title="Remove this save?"
        description={
          confirming
            ? `“${confirming.title}” goes away. It stays recoverable for 30 days.`
            : undefined
        }
        confirmLabel="Remove"
        destructive
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          if (confirming) remove.mutate(confirming.id)
          setConfirming(null)
        }}
      />
    </div>
  )
}
