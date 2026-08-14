/**
 * A converter you can use while standing in a shop.
 *
 * Deliberately separate from the expense form: the commonest use of an
 * exchange rate on a trip is not recording something, it is deciding whether
 * to buy it. Recording it means committing a rate to a row forever; this
 * commits nothing.
 *
 * It goes through the same `/api/fx` handler, so it fills and reads the same
 * permanent cache — using the calculator warms the rate that a later expense
 * on that date will need, and costs the provider nothing the second time.
 */
'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeftRight, Calculator } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/common/states'
import { todayIn } from '@/lib/dates'
import { currencyInfo } from '@/lib/currencies'
import { useCouple } from '@/providers/CoupleProvider'
import { CurrencyPicker } from './CurrencyPicker'
import { getFxRate } from '../api'
import { formatMoney, toBase } from '../logic'

export function RateCalculator({
  baseCurrency,
  destinationCurrency,
}: {
  baseCurrency: string
  destinationCurrency?: string | null
}) {
  const { tzSelf } = useCouple()
  const today = todayIn(tzSelf)

  // Defaults to the direction you actually need on a trip: you are holding a
  // price in the local currency and want to know what it is in yours.
  //
  // Held as an override rather than as state seeded from a prop. The
  // destination is only known once the trip has a chosen city, which can
  // arrive after the first render — syncing that with an effect would be
  // writing state during a render pass, which is both a compiler error and a
  // real bug the moment the user has already picked something.
  const [fromOverride, setFromOverride] = useState<string | null>(null)
  const [toOverride, setToOverride] = useState<string | null>(null)
  const from = fromOverride ?? destinationCurrency ?? 'EUR'
  const to = toOverride ?? baseCurrency

  const [amount, setAmount] = useState('')
  const [on, setOn] = useState(today)

  const rate = useQuery({
    queryKey: ['fx-calc', to, from, on] as const,
    queryFn: () => getFxRate(to, from, on),
    enabled: from !== to,
    // A past date's rate never changes, and today's changes once a day.
    staleTime: 60 * 60_000,
  })

  const parsed = Number(amount.replace(',', '.'))
  const valid = Number.isFinite(parsed) && parsed > 0

  const converted = useMemo(() => {
    if (from === to) return valid ? parsed : null
    if (!rate.data || !valid) return null
    // `rate` is quote-per-base, and `toBase` divides — the same function the
    // expense path uses, so the calculator can never disagree with a saved row.
    return toBase(parsed, rate.data.rate)
  }, [from, to, parsed, valid, rate.data])

  const swap = () => {
    setFromOverride(to)
    setToOverride(from)
  }

  const fromInfo = currencyInfo(from)
  const toInfo = currencyInfo(to)

  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-center gap-2">
        <Calculator className="size-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-sm font-medium">Convert</h2>
        {destinationCurrency && destinationCurrency !== baseCurrency && (
          <span className="ml-auto text-xs text-muted-foreground">
            Where you&rsquo;re going: {destinationCurrency}
          </span>
        )}
      </div>

      <div className="space-y-1">
        <label htmlFor="calc-amount" className="text-sm font-medium">
          Amount
        </label>
        <Input
          id="calc-amount"
          inputMode="decimal"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>

      <div className="flex items-end gap-2">
        <CurrencyPicker
          value={from}
          onChange={setFromOverride}
          label="From"
          id="calc-from"
          suggested={[destinationCurrency, baseCurrency]}
          className="flex-1"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Swap the two currencies"
          className="mb-1"
          onClick={swap}
        >
          <ArrowLeftRight aria-hidden="true" />
        </Button>
        <CurrencyPicker
          value={to}
          onChange={setToOverride}
          label="To"
          id="calc-to"
          suggested={[baseCurrency, destinationCurrency]}
          className="flex-1"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="calc-date" className="text-sm font-medium">
          Rate for
        </label>
        <Input
          id="calc-date"
          type="date"
          max={today}
          value={on}
          onChange={(e) => setOn(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Defaults to today. Pick a past date to check what something cost then.
        </p>
      </div>

      <div className="rounded-md border border-border bg-secondary/40 p-4" aria-live="polite">
        {from === to ? (
          <p className="text-sm text-muted-foreground">
            Same currency — nothing to convert.
          </p>
        ) : rate.isLoading ? (
          <Skeleton className="h-7 w-40" />
        ) : !rate.data ? (
          <p className="text-sm text-muted-foreground">
            No rate available for that date. The provider publishes on working days, so a very
            recent weekend may not be there yet.
          </p>
        ) : !valid ? (
          <p className="text-sm text-muted-foreground">
            1 {to} = {rate.data.rate.toLocaleString(undefined, { maximumFractionDigits: 4 })} {from}
          </p>
        ) : (
          <div className="space-y-1">
            <p className="text-2xl font-semibold tabular-nums">
              {formatMoney(converted ?? 0, to)}
            </p>
            <p className="text-sm text-muted-foreground">
              {formatMoney(parsed, from)} {fromInfo ? `(${fromInfo.name})` : ''} →{' '}
              {toInfo ? toInfo.name : to}
            </p>
            <p className="text-xs text-muted-foreground">
              At {rate.data.rate.toLocaleString(undefined, { maximumFractionDigits: 6 })} {from} per{' '}
              {to}
              {rate.data.rateDate !== on && ` — the rate from ${rate.data.rateDate}, the last one published before ${on}`}
              .
            </p>
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Reference rates from the European Central Bank. A card or a bureau will not give you
        exactly this — treat it as the honest midpoint, not a quote.
      </p>
    </Card>
  )
}
