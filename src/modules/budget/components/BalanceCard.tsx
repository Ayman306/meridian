/**
 * The one line the whole module exists to produce. Spec 13.2:
 * "One line, plainly stated: 'You owe her €142.50'."
 *
 * So it is one line, in plain words, and never a signed number. Everything
 * else on the card is subordinate to it.
 */
'use client'

import { useState } from 'react'
import { ArrowRight, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/common/states'
import { todayIn } from '@/lib/dates'
import { useCouple } from '@/providers/CoupleProvider'
import { useAuth } from '@/providers/AuthProvider'
import { formatMoney } from '../logic'
import type { Balance, BalanceLine } from '../types'
import type { SettlementFormValues } from '../schemas'

export function BalanceCard({
  balance,
  line,
  isLoading,
  tripId,
  onSettle,
  settling,
}: {
  balance: Balance
  line: BalanceLine
  isLoading?: boolean
  tripId?: string | null
  onSettle: (values: SettlementFormValues) => void
  settling?: boolean
}) {
  const { partnerRef, tzSelf } = useCouple()
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('')

  if (isLoading) {
    return (
      <Card className="space-y-2 p-5">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-48" />
      </Card>
    )
  }

  const them = partnerRef?.displayName ?? 'your partner'

  return (
    <Card className="space-y-4 p-5">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Balance</p>
        {line.direction === 'square' ? (
          <p className="mt-1 flex items-center gap-2 text-2xl font-semibold">
            <Check className="size-5 text-accent" aria-hidden="true" />
            You&rsquo;re square
          </p>
        ) : (
          <p className="mt-1 text-2xl font-semibold">
            {line.direction === 'owed' ? (
              <>
                {them} owes you{' '}
                <span className="tabular-nums">{formatMoney(line.amount, line.currency)}</span>
              </>
            ) : (
              <>
                You owe {them}{' '}
                <span className="tabular-nums">{formatMoney(line.amount, line.currency)}</span>
              </>
            )}
          </p>
        )}
      </div>

      {balance.unconverted > 0 && (
        <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-500">
          {balance.unconverted === 1
            ? 'One expense has not been converted yet, so this figure is incomplete.'
            : `${balance.unconverted} expenses have not been converted yet, so this figure is incomplete.`}{' '}
          They convert overnight.
        </p>
      )}

      {line.direction !== 'square' && partnerRef && user && (
        <div>
          {open ? (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                const value = Number(amount.replace(',', '.'))
                if (!Number.isFinite(value) || value <= 0) return
                onSettle({
                  amount: value,
                  currency: line.currency,
                  settled_on: todayIn(tzSelf),
                  // The person who owes is the one paying.
                  from_user: line.direction === 'owes' ? user.id : partnerRef.id,
                  to_user: line.direction === 'owes' ? partnerRef.id : user.id,
                  trip_id: tripId ?? null,
                  method: null,
                  notes: null,
                })
                setOpen(false)
                setAmount('')
              }}
            >
              <div className="flex-1 space-y-1">
                <label htmlFor="settle-amount" className="text-xs text-muted-foreground">
                  Amount settled ({line.currency})
                </label>
                <Input
                  id="settle-amount"
                  inputMode="decimal"
                  autoFocus
                  value={amount}
                  placeholder={line.amount.toFixed(2)}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <Button type="submit" disabled={settling}>
                {settling ? 'Recording…' : 'Record'}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </form>
          ) : (
            <Button
              variant="outline"
              onClick={() => {
                setAmount(line.amount.toFixed(2))
                setOpen(true)
              }}
            >
              Settle up
              <ArrowRight aria-hidden="true" />
            </Button>
          )}
        </div>
      )}
    </Card>
  )
}
