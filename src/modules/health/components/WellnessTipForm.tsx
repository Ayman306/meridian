/**
 * Add or edit one of the couple's own wellness tips (0040).
 *
 * The source link is required, because a tip of your own is still advisory:
 * it points at the authority rather than being one (non-negotiable #4). The
 * date shown beside it is the day it was written down — set here on create,
 * and moved only when the link changes.
 */
'use client'

import { useId } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { userMessage } from '@/lib/errors'
import {
  TIP_AUDIENCES,
  TIP_AUDIENCE_LABELS,
  TIP_BODY_MAX,
  TIP_CATEGORIES,
  TIP_CATEGORY_LABELS,
} from '../logic'
import { useCreateWellnessTip, useUpdateWellnessTip } from '../hooks'
import { wellnessTipSchema, type WellnessTipFormValues } from '../schemas'
import type { TipAudience, TipCategory, WellnessTip } from '../types'

const EMPTY: WellnessTipFormValues = {
  title: '',
  body: '',
  category: 'trip_prep',
  audience: 'everyone',
  source_url: '',
}

export function WellnessTipForm({
  tip,
  onDone,
}: {
  /** The tip being edited, or nothing to add a new one. */
  tip?: WellnessTip | null
  onDone: () => void
}) {
  const uid = useId()
  const create = useCreateWellnessTip()
  const update = useUpdateWellnessTip()
  const saving = create.isPending || update.isPending
  const failure = create.error ?? update.error

  const form = useForm<WellnessTipFormValues>({
    resolver: zodResolver(wellnessTipSchema),
    defaultValues: tip
      ? {
          title: tip.title,
          body: tip.body,
          category: tip.category as TipCategory,
          audience: tip.audience as TipAudience,
          source_url: tip.source_url,
        }
      : EMPTY,
  })
  const errors = form.formState.errors
  const bodyLength = useWatch({ control: form.control, name: 'body' }).length

  const onSubmit = form.handleSubmit(async (values) => {
    if (tip) await update.mutateAsync({ tip, input: values })
    else await create.mutateAsync(values)
    onDone()
  })

  return (
    <Card className="p-4">
      <form onSubmit={onSubmit} className="space-y-3" noValidate>
        <p className="text-sm font-medium">{tip ? 'Edit your tip' : 'Add a tip of your own'}</p>

        <Field label="Title" htmlFor={`${uid}-title`} error={errors.title?.message}>
          <Input id={`${uid}-title`} autoComplete="off" {...form.register('title')} />
        </Field>

        <Field
          label="What it says"
          htmlFor={`${uid}-body`}
          hint={`${bodyLength} of ${TIP_BODY_MAX}`}
          error={errors.body?.message}
        >
          <Textarea id={`${uid}-body`} rows={3} {...form.register('body')} />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Section" htmlFor={`${uid}-category`}>
            <Select id={`${uid}-category`} {...form.register('category')}>
              {TIP_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {TIP_CATEGORY_LABELS[category]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="For" htmlFor={`${uid}-audience`}>
            <Select id={`${uid}-audience`} {...form.register('audience')}>
              {TIP_AUDIENCES.map((audience) => (
                <option key={audience} value={audience}>
                  {TIP_AUDIENCE_LABELS[audience]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field
          label="Source"
          htmlFor={`${uid}-source`}
          hint="Where this comes from. The linked page is the authority, not this tip."
          error={errors.source_url?.message}
        >
          <Input
            id={`${uid}-source`}
            type="url"
            inputMode="url"
            placeholder="https://"
            autoComplete="off"
            {...form.register('source_url')}
          />
        </Field>

        {failure ? (
          <p className="text-sm text-destructive" role="alert">
            {userMessage(failure)}
          </p>
        ) : null}

        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? 'Saving…' : tip ? 'Save' : 'Add tip'}
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={onDone}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  )
}
