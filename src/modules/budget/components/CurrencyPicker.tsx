/**
 * Pick a currency from all of them, not from a shortlist of eight.
 *
 * A native `<select>` with fifty options is unusable on a phone, and a
 * combobox that hijacks typing is worse. This is a text input with a filtered
 * list under it: type "yen", "JPY" or "¥" and get the same row. The value it
 * commits is always a three-letter code.
 *
 * `suggested` floats the codes that are actually likely — the couple's base
 * currency, the destination's, whatever was used last — to the top, because
 * scrolling past forty currencies to reach the one you are standing in is the
 * thing this is meant to avoid.
 */
'use client'

import { useId, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { CURRENCIES, currencyInfo, searchCurrencies } from '@/lib/currencies'

export function CurrencyPicker({
  value,
  onChange,
  suggested = [],
  label = 'Currency',
  id,
  className,
}: {
  value: string
  onChange: (code: string) => void
  /** Codes to float to the top, in order. Duplicates are dropped. */
  suggested?: (string | null | undefined)[]
  label?: string
  id?: string
  className?: string
}) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const listId = `${inputId}-list`
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const blurTimer = useRef<number | null>(null)

  const top = useMemo(
    () => [...new Set(suggested.filter((c): c is string => Boolean(c)))],
    [suggested],
  )

  const results = useMemo(() => {
    const matches = searchCurrencies(query)
    if (query.trim()) return matches
    // No query: suggestions first, then everything else in order.
    const suggestedRows = top
      .map((code) => currencyInfo(code))
      .filter((c): c is NonNullable<typeof c> => c !== null)
    const rest = CURRENCIES.filter((c) => !top.includes(c.code))
    return [...suggestedRows, ...rest]
  }, [query, top])

  const current = currencyInfo(value)

  const commit = (code: string) => {
    onChange(code)
    setQuery('')
    setOpen(false)
  }

  return (
    <div className={cn('relative space-y-1', className)}>
      <label htmlFor={inputId} className="text-sm font-medium">
        {label}
      </label>
      <div className="relative">
        <Input
          id={inputId}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          className="pr-8"
          // Shows the chosen code until the field is focused, then becomes a
          // search box. One control, two jobs, no separate "edit" affordance.
          value={open ? query : value}
          placeholder={current ? `${current.symbol} ${current.name}` : 'Currency'}
          onFocus={() => {
            setQuery('')
            setOpen(true)
          }}
          onBlur={() => {
            // Deferred so a click on a row lands before the list unmounts.
            blurTimer.current = window.setTimeout(() => setOpen(false), 120)
          }}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setOpen(false)
              return
            }
            if (e.key === 'Enter' && open) {
              e.preventDefault()
              const first = results[0]
              if (first) commit(first.code)
            }
          }}
        />
        <ChevronDown
          className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
      </div>

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-background shadow-lg"
        >
          {results.length === 0 && (
            <li className="px-3 py-2 text-sm text-muted-foreground">No currency matches that.</li>
          )}
          {results.map((currency, i) => {
            const isSuggested = !query.trim() && i < top.length
            return (
              <li key={currency.code}>
                <button
                  type="button"
                  role="option"
                  aria-selected={currency.code === value}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-secondary',
                    currency.code === value && 'bg-secondary/60',
                    isSuggested && 'bg-accent/5',
                  )}
                  onMouseDown={() => {
                    // mousedown, not click: blur fires first otherwise.
                    if (blurTimer.current) window.clearTimeout(blurTimer.current)
                    commit(currency.code)
                  }}
                >
                  <span className="w-10 shrink-0 font-medium tabular-nums">{currency.code}</span>
                  <span className="w-8 shrink-0 text-muted-foreground">{currency.symbol}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {currency.name}
                  </span>
                  {currency.code === value && (
                    <Check className="size-4 shrink-0 text-accent" aria-hidden="true" />
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
