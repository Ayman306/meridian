/**
 * Creating a trip must be cheap. Title is the only required field; dates are
 * prominent but skippable, and the precision selector exists so "sometime next
 * spring" is a first-class answer rather than a blank.
 */
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { useCreateTrip, useTripStatuses } from '../hooks'
import { createTripSchema, type CreateTripValues } from '../schemas'
import { snapStartToPrecision } from '../logic'
import type { DatePrecision } from '../types'
import { userMessage } from '@/lib/errors'

const PRECISIONS: { value: DatePrecision; label: string; hint: string }[] = [
  { value: 'exact', label: 'Exact dates', hint: 'We know the days' },
  { value: 'month', label: 'A month', hint: 'November 2026' },
  { value: 'season', label: 'A season', hint: 'Spring 2026' },
  { value: 'year', label: 'A year', hint: 'Sometime in 2026' },
  { value: 'unknown', label: 'No idea yet', hint: 'Just the idea' },
]

export function NewTripPage() {
  const navigate = useNavigate()
  const create = useCreateTrip()
  const statuses = useTripStatuses()

  const form = useForm<CreateTripValues>({
    resolver: zodResolver(createTripSchema),
    defaultValues: {
      title: '',
      start_date: null,
      end_date: null,
      date_precision: 'unknown',
      is_open_ended: false,
      status_id: null,
      notes: null,
    },
  })

  const precision = form.watch('date_precision')
  const isOpenEnded = form.watch('is_open_ended')
  const showDates = precision !== 'unknown'
  const showEnd = precision === 'exact' && !isOpenEnded

  const onSubmit = form.handleSubmit(async (values) => {
    const idea = statuses.data?.find((s) => s.name === 'Idea')
    const start = values.start_date
      ? snapStartToPrecision(values.start_date, values.date_precision)
      : null

    const trip = await create.mutateAsync({
      title: values.title,
      start_date: start,
      end_date: values.date_precision === 'exact' && !values.is_open_ended ? values.end_date : null,
      date_precision: values.date_precision,
      is_open_ended: values.is_open_ended,
      status_id: values.status_id ?? idea?.id ?? null,
      notes: values.notes ?? null,
    })
    navigate(`/trips/${trip.id}`, { replace: true })
  })

  return (
    <>
      <PageHeader title="New trip" description="A name is enough. Everything else can wait." />

      <Card className="max-w-xl">
        <CardContent className="pt-5">
          <form onSubmit={onSubmit} className="space-y-5">
            <Field label="What are you calling it?" error={form.formState.errors.title?.message} htmlFor="title">
              <Input id="title" placeholder="Lisbon, or two weeks somewhere warm" {...form.register('title')} />
            </Field>

            <Field label="How well do you know the dates?" htmlFor="precision">
              <Select id="precision" {...form.register('date_precision')}>
                {PRECISIONS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label} — {p.hint}
                  </option>
                ))}
              </Select>
            </Field>

            {showDates && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label={precision === 'exact' ? 'Start' : 'Any day in that period'}
                  error={form.formState.errors.start_date?.message}
                  htmlFor="start"
                >
                  <Input id="start" type="date" {...form.register('start_date')} />
                </Field>
                {showEnd && (
                  <Field label="End" error={form.formState.errors.end_date?.message} htmlFor="end">
                    <Input id="end" type="date" {...form.register('end_date')} />
                  </Field>
                )}
              </div>
            )}

            {precision === 'exact' && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4" {...form.register('is_open_ended')} />
                Open-ended — we don&apos;t know when it finishes
              </label>
            )}

            <Field label="Notes" hint="Optional" htmlFor="notes">
              <Textarea id="notes" rows={3} {...form.register('notes')} />
            </Field>

            {create.error ? (
              <p className="text-sm text-destructive" role="alert">
                {userMessage(create.error)}
              </p>
            ) : null}

            <div className="flex gap-2">
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? 'Creating…' : 'Create trip'}
              </Button>
              <Button type="button" variant="ghost" onClick={() => navigate(-1)}>
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </>
  )
}
