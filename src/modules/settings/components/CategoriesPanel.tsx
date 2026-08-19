/**
 * Renaming and recolouring the four seeded lists. Spec 14.2.
 *
 * They are seeded per couple, which has always meant they were editable in
 * principle and nowhere in practice — so a couple who thinks of "Food" as
 * "Eating" had a category they disagreed with on every screen forever.
 *
 * ## Four tables, one panel, and no generic abstraction
 *
 * `categories`, `expense_categories`, `document_types` and `trip_statuses` have
 * four different shapes. Only three carry a colour, and `document_types` has
 * flags where the others have one. The panel branches on that rather than
 * inventing a common shape, because a form that offers a colour picker for
 * something with nowhere to store the answer is worse than four small forms.
 *
 * ## Deleting is allowed, and says what it does
 *
 * Every reference to these is `on delete set null`, so removing one unfiles
 * what used it rather than deleting anything. That is the only reason a delete
 * is offered at all, and the copy says so — "12 items become uncategorised" is
 * a decision somebody can make; "delete" alone is a gamble.
 */
'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ErrorState, SkeletonList } from '@/components/common/states'
import { useCouple } from '@/providers/CoupleProvider'
import * as api from '../api'
import type { CategoryKind } from '../api'

const TABS: { kind: CategoryKind; label: string; hint: string }[] = [
  { kind: 'categories', label: 'Itinerary', hint: 'What a planned item is — food, walking, museum.' },
  { kind: 'expense_categories', label: 'Expenses', hint: 'How money is grouped on the charts.' },
  { kind: 'document_types', label: 'Documents', hint: 'Passport, visa, insurance.' },
  { kind: 'trip_statuses', label: 'Trip status', hint: 'Planning, booked, done.' },
]

export function CategoriesPanel() {
  const { coupleId } = useCouple()
  const [kind, setKind] = useState<CategoryKind>('categories')
  const qc = useQueryClient()

  const list = useQuery({
    queryKey: ['editable-categories', kind, coupleId ?? 'none'] as const,
    queryFn: () => api.listCategoriesOf(kind, coupleId!),
    enabled: Boolean(coupleId),
  })

  // Every list here feeds a screen elsewhere, so a rename has to invalidate
  // more than its own query. Clearing broadly is right: these change rarely,
  // and a stale category name on the plan is exactly the bug this panel is
  // meant to fix.
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['editable-categories'] })
    void qc.invalidateQueries({ queryKey: ['categories'] })
    void qc.invalidateQueries({ queryKey: ['expense-categories'] })
    void qc.invalidateQueries({ queryKey: ['document-types'] })
    void qc.invalidateQueries({ queryKey: ['trip-statuses'] })
  }

  const rename = useMutation({
    mutationFn: ({ id, name, color }: { id: string; name?: string; color?: string | null }) =>
      api.renameCategory(kind, id, { name, color }),
    onSuccess: refresh,
  })
  const add = useMutation({
    mutationFn: ({ name, color }: { name: string; color: string | null }) =>
      api.addCategory(kind, coupleId!, name, color),
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.removeCategory(kind, id),
    onSuccess: refresh,
  })

  const [newName, setNewName] = useState('')
  const colorful = api.supportsColor(kind)
  const active = TABS.find((tab) => tab.kind === kind)!

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Which list to edit">
        {TABS.map((tab) => (
          <button
            key={tab.kind}
            role="tab"
            aria-selected={kind === tab.kind}
            className={
              kind === tab.kind
                ? 'rounded-md bg-secondary px-3 py-1.5 text-sm font-medium'
                : 'rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-secondary/60'
            }
            onClick={() => setKind(tab.kind)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{active.hint}</p>

      {list.isLoading ? (
        <SkeletonList rows={3} />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : (
        <ul className="space-y-2">
          {(list.data ?? []).map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-2">
              {colorful && (
                <input
                  type="color"
                  aria-label={`Colour for ${item.name}`}
                  className="size-8 shrink-0 rounded border border-input bg-background"
                  value={item.color ?? '#888888'}
                  onChange={(e) => rename.mutate({ id: item.id, color: e.target.value })}
                />
              )}
              <Input
                className="max-w-56"
                defaultValue={item.name}
                aria-label={`Name of ${item.name}`}
                onBlur={(e) => {
                  const value = e.target.value.trim()
                  if (value && value !== item.name) rename.mutate({ id: item.id, name: value })
                }}
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove ${item.name}`}
                disabled={remove.isPending}
                onClick={() => remove.mutate(item.id)}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="flex flex-wrap gap-2 border-t border-border pt-3"
        onSubmit={(e) => {
          e.preventDefault()
          const name = newName.trim()
          if (!name) return
          add.mutate({ name, color: null }, { onSuccess: () => setNewName('') })
        }}
      >
        <Input
          className="max-w-56"
          value={newName}
          placeholder={`New ${active.label.toLowerCase()}`}
          aria-label={`New ${active.label.toLowerCase()}`}
          onChange={(e) => setNewName(e.target.value)}
        />
        <Button type="submit" size="sm" variant="outline" disabled={!newName.trim() || add.isPending}>
          <Plus aria-hidden="true" />
          Add
        </Button>
      </form>

      <p className="text-xs text-muted-foreground">
        Removing one does not delete anything that used it — those items simply become
        uncategorised.
      </p>

      {(rename.error || add.error || remove.error) && (
        <ErrorState
          error={rename.error ?? add.error ?? remove.error}
          title="That did not save"
        />
      )}
    </Card>
  )
}
