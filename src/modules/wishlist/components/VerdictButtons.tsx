/**
 * Yes / maybe / no on the other person's save.
 *
 * Three buttons and no confirmation step, including for un-voting: spec 7.2
 * says changing your mind is one click, and a dialog asking whether you really
 * meant "maybe" would be absurd.
 */
'use client'

import { Check, HelpCircle, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Verdict } from '../types'

const OPTIONS = [
  { value: 'yes', label: 'Yes', Icon: Check, on: 'bg-[hsl(var(--ok))]/15 text-[hsl(var(--ok))]' },
  {
    value: 'maybe',
    label: 'Maybe',
    Icon: HelpCircle,
    on: 'bg-[hsl(var(--warn))]/15 text-[hsl(var(--warn))]',
  },
  { value: 'no', label: 'No', Icon: X, on: 'bg-destructive/10 text-destructive' },
] as const satisfies readonly { value: Verdict; label: string; Icon: typeof Check; on: string }[]

export function VerdictButtons({
  current,
  onSet,
  disabled,
}: {
  current: Verdict | null
  onSet: (verdict: Verdict | null) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Your verdict">
      {OPTIONS.map(({ value, label, Icon, on }) => {
        const active = current === value
        return (
          <button
            key={value}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            title={active ? `${label} — click again to un-vote` : label}
            // Clicking the active one clears it. Having voted is not a state
            // you should be stuck in.
            onClick={() => onSet(active ? null : value)}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50',
              active ? `border-transparent ${on}` : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="size-3.5" aria-hidden="true" />
            {label}
          </button>
        )
      })}
    </div>
  )
}
