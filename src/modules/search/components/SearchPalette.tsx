/**
 * One box that finds anything.
 *
 * A dialog rather than a field in the header, for two reasons. It needs the
 * whole keyboard — arrows to move, enter to open, escape to leave — and a field
 * that captures those while sitting inside a page is a field that breaks the
 * page's own shortcuts. And on a phone there is no room for a permanent search
 * field beside eleven navigation items.
 *
 * ## The keyboard is the feature
 *
 * Anyone who searches twice will search a hundred times, so ⌘K/Ctrl+K opens it
 * from anywhere, arrows move, enter opens, escape closes. The list is a
 * `listbox` with `aria-activedescendant`, which is what lets focus stay in the
 * input while the *selection* moves — the pattern every command palette uses
 * and the only one where typing and choosing do not fight each other.
 *
 * ## What it does not do
 *
 * It does not search health records. They are owner-private, and a box that
 * surfaces a medication while somebody is looking for a restaurant is not a
 * feature. That exclusion lives in the database function, not here — a filter
 * in the client would be a filter somebody could remove without noticing.
 */
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  BedDouble,
  CalendarRange,
  FileText,
  Heart,
  Image as ImageIcon,
  MapPin,
  Search,
  Wallet,
  X,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { formatDateOnly } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { useSearch } from '../hooks'
import { KIND_LABELS, MIN_QUERY_LENGTH, groupResults, hrefFor, isSearchable } from '../logic'
import type { ResultKind, SearchResult } from '../types'

const ICONS: Record<ResultKind, typeof Search> = {
  trip: CalendarRange,
  plan: CalendarRange,
  saved: Heart,
  stay: BedDouble,
  document: FileText,
  expense: Wallet,
  photo: ImageIcon,
  destination: MapPin,
}

/**
 * Mounted only while open, so closing it genuinely resets it.
 *
 * The alternative — one long-lived instance that returns null when closed —
 * keeps its state, so reopening shows the last query and the last results.
 * Clearing that in an effect is the classic "synchronise state you could have
 * derived" mistake; not existing is simpler and cannot get out of step.
 */
export function SearchPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null
  return <Palette onClose={onClose} />
}

function Palette({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const search = useSearch(query)
  const results = useMemo(() => search.data ?? [], [search.data])
  const groups = useMemo(() => groupResults(results), [results])
  // Flattened in the same order the groups render, so the arrow keys and the
  // eye agree about what "next" means.
  const flat = useMemo(() => groups.flatMap((group) => group.results), [groups])

  /**
   * Where the highlight is, derived rather than synchronised.
   *
   * A new result set has to reset the highlight — otherwise index 3 of the old
   * list silently becomes index 3 of the new one, and enter opens something
   * nobody looked at. Storing which list the index belongs to makes that
   * derivable: when the signature no longer matches, the answer is zero, with
   * no effect and no window where the two disagree.
   */
  const signature = flat.map((r) => `${r.kind}:${r.id}`).join(',')
  const [selection, setSelection] = useState({ signature: '', index: 0 })
  const cursor = selection.signature === signature ? selection.index : 0
  const setCursor = (next: number | ((current: number) => number)) =>
    setSelection({
      signature,
      index: typeof next === 'function' ? next(cursor) : next,
    })

  // Focus is a DOM effect, not state. A frame later, because the dialog is not
  // in the document on the tick that mounts it.
  useEffect(() => {
    const frame = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [])

  // Keep the highlighted row on screen when the arrows move past the fold.
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  const go = (result: SearchResult) => {
    router.push(hrefFor(result))
    onClose()
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (flat.length === 0) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      // Wraps, because a list that stops at the bottom makes somebody hold a
      // key wondering whether it is broken.
      setCursor((c) => (c + 1) % flat.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setCursor((c) => (c - 1 + flat.length) % flat.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const chosen = flat[cursor]
      if (chosen) go(chosen)
    }
  }

  const tooShort = query.trim().length > 0 && !isSearchable(query)

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[10vh] backdrop-blur-sm"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search everything"
        className="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Trips, places, documents, photos…"
            aria-label="Search everything"
            role="combobox"
            aria-expanded={flat.length > 0}
            aria-controls="search-results"
            aria-activedescendant={flat[cursor] ? `search-result-${flat[cursor]!.id}` : undefined}
            autoComplete="off"
            className="border-0 bg-transparent focus-visible:ring-0"
          />
          <Button variant="ghost" size="icon" aria-label="Close search" onClick={onClose}>
            <X aria-hidden="true" />
          </Button>
        </div>

        <div id="search-results" ref={listRef} role="listbox" className="overflow-y-auto p-2">
          {tooShort ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              Keep going — {MIN_QUERY_LENGTH} characters or more.
            </p>
          ) : !isSearchable(query) ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              Search everything you have both saved. Trips, plans, places, stays, documents,
              expenses and photos.
            </p>
          ) : search.isError ? (
            <p className="px-2 py-6 text-center text-sm text-destructive">
              That search did not work. Try again.
            </p>
          ) : flat.length === 0 && !search.isFetching ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              Nothing matches “{query.trim()}”.
            </p>
          ) : (
            groups.map((group) => (
              <section key={group.kind} className="mb-2 last:mb-0">
                <h2 className="px-2 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {KIND_LABELS[group.kind]}
                </h2>
                {group.results.map((result) => {
                  const index = flat.indexOf(result)
                  const Icon = ICONS[result.kind]
                  const selected = index === cursor
                  return (
                    <button
                      key={`${result.kind}-${result.id}`}
                      id={`search-result-${result.id}`}
                      role="option"
                      aria-selected={selected}
                      data-selected={selected}
                      // Pointer moves the cursor too, so the mouse and the
                      // keyboard never disagree about what is highlighted.
                      onMouseEnter={() => setCursor(index)}
                      onClick={() => go(result)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm',
                        selected ? 'bg-secondary' : 'hover:bg-secondary/60',
                      )}
                    >
                      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{result.title}</span>
                        {result.subtitle && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {result.subtitle}
                          </span>
                        )}
                      </span>
                      {result.occurred && (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {formatDateOnly(result.occurred, 'MMM yyyy')}
                        </span>
                      )}
                    </button>
                  )
                })}
              </section>
            ))
          )}
        </div>

        <p className="hidden border-t border-border px-3 py-2 text-xs text-muted-foreground sm:block">
          <kbd className="rounded border border-border px-1">↑</kbd>{' '}
          <kbd className="rounded border border-border px-1">↓</kbd> to move ·{' '}
          <kbd className="rounded border border-border px-1">↵</kbd> to open ·{' '}
          <kbd className="rounded border border-border px-1">esc</kbd> to close
        </p>
      </div>
    </div>
  )
}
