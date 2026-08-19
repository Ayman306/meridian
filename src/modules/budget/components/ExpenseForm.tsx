/**
 * Add or edit one expense. Spec 13.2.
 *
 * The split control is the part worth care. Exact and percent splits are
 * rejected when they do not add up — spec 13.3 is explicit that silent
 * rounding compounds — so the error has to say what is wrong while the person
 * is still typing, and it has to name the shortfall rather than saying
 * "invalid".
 */
'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ErrorState } from '@/components/common/states'
import { todayIn } from '@/lib/dates'
import { currencyInfo } from '@/lib/currencies'
import { cn } from '@/lib/utils'
import { useCouple } from '@/providers/CoupleProvider'
import { useAuth } from '@/providers/AuthProvider'
import { expenseSchema, type ExpenseFormValues } from '../schemas'
import { formatMoney, validateSplit } from '../logic'
import { useBaseCurrency, useExpenseCategories } from '../hooks'
import { useItems } from '@/modules/itinerary'
import { useStays } from '@/modules/stays'
import { CurrencyPicker } from './CurrencyPicker'
import { ReceiptPicker } from './ReceiptPicker'
import type { Expense, SplitType } from '../types'

const SPLIT_LABELS: Record<SplitType, string> = {
  equal: 'Split evenly',
  exact: 'Exact amounts',
  percent: 'By percentage',
  full: 'One of us covers it',
}

export function ExpenseForm({
  tripId,
  existing,
  destinationCurrency,
  onSubmit,
  onCancel,
  pending,
  error,
}: {
  tripId?: string | null
  existing?: Expense
  /** Where the trip is going, so the picker offers it first. */
  destinationCurrency?: string | null
  onSubmit: (values: ExpenseFormValues) => void
  onCancel: () => void
  pending?: boolean
  error?: unknown
}) {
  const { selfRef, partnerRef, tzSelf } = useCouple()
  const { user } = useAuth()
  const categories = useExpenseCategories()
  const baseCurrency = useBaseCurrency()
  const planItems = useItems(tripId ?? undefined)
  const stays = useStays(tripId ?? undefined)

  const form = useForm<ExpenseFormValues>({
    resolver: zodResolver(expenseSchema),
    defaultValues: {
      description: existing?.description ?? '',
      amount: existing ? Number(existing.amount) : undefined,
      // Where you are is what you are most likely spending, so a trip with a
      // chosen destination defaults to its currency rather than to the base.
      currency: existing?.currency ?? destinationCurrency ?? baseCurrency,
      spent_on: existing?.spent_on ?? todayIn(tzSelf),
      paid_by: existing?.paid_by ?? user?.id ?? '',
      split_type: (existing?.split_type as SplitType) ?? 'equal',
      split_detail: (existing?.split_detail as Record<string, number> | null) ?? null,
      category_id: existing?.category_id ?? null,
      trip_id: existing?.trip_id ?? tripId ?? null,
      itinerary_item_id: existing?.itinerary_item_id ?? null,
      accommodation_id: existing?.accommodation_id ?? null,
      receipt_media_id: existing?.receipt_media_id ?? null,
      notes: existing?.notes ?? '',
    },
  })

  const splitType = form.watch('split_type') as SplitType
  const amount = Number(form.watch('amount')) || 0
  const currency = form.watch('currency') || baseCurrency
  const paidBy = form.watch('paid_by')

  // Kept out of react-hook-form: it is two numbers, one of which is derived,
  // and running it through the resolver would fight the cross-field rule.
  const [partnerShare, setPartnerShare] = useState<string>(() => {
    const detail = (existing?.split_detail as Record<string, number> | null) ?? null
    const partnerId = partnerRef?.id
    return detail && partnerId && detail[partnerId] !== undefined ? String(detail[partnerId]) : ''
  })

  const partnerId = partnerRef?.id ?? null
  const needsDetail = splitType === 'exact' || splitType === 'percent'
  const detail =
    needsDetail && partnerId && partnerShare !== ''
      ? { [partnerId]: Number(partnerShare) }
      : needsDetail
        ? {}
        : null

  const splitProblem = needsDetail
    ? validateSplit(
        splitType,
        amount,
        // The payer covers whatever is left, so their side is derived rather
        // than typed. Validation still sees both numbers.
        detail && partnerId && paidBy !== partnerId
          ? { ...detail, [paidBy]: remainderFor(splitType, amount, Number(partnerShare)) }
          : detail,
      )
    : null

  const submit = form.handleSubmit((values) => {
    if (splitProblem) return
    onSubmit({ ...values, split_detail: detail })
  })

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1">
        <label htmlFor="description" className="text-sm font-medium">
          What was it for?
        </label>
        <Input id="description" autoFocus {...form.register('description')} />
        <FieldError message={form.formState.errors.description?.message} />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1 sm:col-span-2">
          <label htmlFor="amount" className="text-sm font-medium">
            Amount
          </label>
          <Input id="amount" inputMode="decimal" placeholder="0.00" {...form.register('amount')} />
          <FieldError message={form.formState.errors.amount?.message} />
        </div>
        <CurrencyPicker
          id="currency"
          value={currency}
          onChange={(code) => form.setValue('currency', code, { shouldValidate: true })}
          suggested={[destinationCurrency, baseCurrency]}
        />
      </div>

      {currency !== baseCurrency && (
        <p className="rounded-md bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
          {currencyInfo(currency)?.name ?? currency} → converted to {baseCurrency} at the rate for
          the day it was spent, and fixed there. If the rate cannot be reached, it saves anyway and
          converts overnight.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label htmlFor="spent_on" className="text-sm font-medium">
            When
          </label>
          <Input id="spent_on" type="date" {...form.register('spent_on')} />
          <FieldError message={form.formState.errors.spent_on?.message} />
        </div>
        <div className="space-y-1">
          <label htmlFor="category_id" className="text-sm font-medium">
            Category
          </label>
          <select
            id="category_id"
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            {...form.register('category_id')}
          >
            <option value="">No category</option>
            {categories.data?.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Who paid</legend>
        <div className="flex gap-2">
          {[selfRef, partnerRef].filter(Boolean).map((person) => (
            <label
              key={person!.id}
              className={cn(
                'flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm',
                paidBy === person!.id ? 'border-accent bg-accent/10' : 'border-input',
              )}
            >
              <input
                type="radio"
                value={person!.id}
                className="sr-only"
                {...form.register('paid_by')}
              />
              {person!.isSelf ? 'You' : person!.displayName}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">How it splits</legend>
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(SPLIT_LABELS) as SplitType[]).map((type) => (
            <label
              key={type}
              className={cn(
                'cursor-pointer rounded-md border px-3 py-2 text-center text-sm',
                splitType === type ? 'border-accent bg-accent/10' : 'border-input',
                // Nothing to split with in solo mode.
                !partnerId && type !== 'full' && 'opacity-50',
              )}
            >
              <input
                type="radio"
                value={type}
                className="sr-only"
                disabled={!partnerId && type !== 'full'}
                {...form.register('split_type')}
              />
              {SPLIT_LABELS[type]}
            </label>
          ))}
        </div>

        {needsDetail && partnerRef && (
          <div className="space-y-1">
            <label htmlFor="partner-share" className="text-sm">
              {partnerRef.isSelf ? 'Your' : `${partnerRef.displayName}’s`} share
              {splitType === 'percent' ? ' (%)' : ''}
            </label>
            <Input
              id="partner-share"
              inputMode="decimal"
              value={partnerShare}
              onChange={(e) => setPartnerShare(e.target.value)}
              aria-invalid={Boolean(splitProblem)}
              aria-describedby={splitProblem ? 'split-problem' : undefined}
            />
            {splitProblem ? (
              <p id="split-problem" role="alert" className="text-xs text-destructive">
                {splitProblem.message}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                The rest — {formatMoney(remainderFor(splitType, amount, Number(partnerShare) || 0), currency)}
                {splitType === 'percent' ? '' : ''} — is on whoever paid.
              </p>
            )}
          </div>
        )}

        {splitType === 'equal' && amount > 0 && partnerRef && (
          <p className="text-xs text-muted-foreground">
            {formatMoney(Math.floor(Math.round(amount * 100) / 2) / 100, currency)} each
            {Math.round(amount * 100) % 2 === 1 && ', and the odd cent goes to whoever paid'}.
          </p>
        )}

        {splitType === 'full' && (
          <p className="text-xs text-muted-foreground">
            Counts toward the trip total, but creates no debt.
          </p>
        )}
      </fieldset>

      {/* What this was for, in the plan's own terms. The columns for these
          have existed since Phase 12 with nothing to fill them, so an expense
          could sit next to the thing it paid for and never point at it. Only
          offered inside a trip — outside one there is nothing to point at. */}
      {tripId && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="itinerary_item_id" className="text-sm font-medium">
              Part of the plan
            </label>
            <select
              id="itinerary_item_id"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              {...form.register('itinerary_item_id')}
            >
              <option value="">Not linked</option>
              {(planItems.data ?? [])
                .filter((item) => item.scheduled_date !== null)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.scheduled_date} · {item.title}
                  </option>
                ))}
            </select>
          </div>

          <div className="space-y-1">
            <label htmlFor="accommodation_id" className="text-sm font-medium">
              A stay
            </label>
            <select
              id="accommodation_id"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              {...form.register('accommodation_id')}
            >
              <option value="">Not linked</option>
              {(stays.data ?? []).map((stay) => (
                <option key={stay.id} value={stay.id}>
                  {stay.name}
                  {stay.check_in ? ` · ${stay.check_in}` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* The receipt. Picked from photos already in the gallery rather than
          uploaded here: the upload pipeline — EXIF, derivatives, the quota —
          lives in one place, and a second one would drift from it. */}
      <ReceiptPicker
        tripId={tripId ?? null}
        value={form.watch('receipt_media_id') ?? null}
        onChange={(id) => form.setValue('receipt_media_id', id, { shouldDirty: true })}
      />

      <div className="space-y-1">
        <label htmlFor="notes" className="text-sm font-medium">
          Notes
        </label>
        <Input id="notes" {...form.register('notes')} />
      </div>

      {error ? <ErrorState error={error} title="That did not save" /> : null}

      <div className="flex gap-2 pt-2">
        <Button type="submit" disabled={pending || Boolean(splitProblem)} className="flex-1">
          {pending ? 'Saving…' : existing ? 'Save changes' : 'Add expense'}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

/** What the payer is left with once the other side's share is taken out. */
function remainderFor(splitType: SplitType, amount: number, share: number): number {
  if (splitType === 'percent') return Math.max(0, (amount * (100 - share)) / 100)
  return Math.max(0, amount - share)
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <p role="alert" className="text-xs text-destructive">
      {message}
    </p>
  )
}
