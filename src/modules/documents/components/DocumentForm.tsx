'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { userMessage } from '@/lib/errors'
import { MAX_DOCUMENT_BYTES } from '@/lib/constants'
import { useUploadDocument } from '../hooks'
import { documentSchema, type DocumentFormValues } from '../schemas'
import { ACCEPTED_MIME_TYPES, formatBytes } from '../logic'
import type { DocumentType } from '../types'

export function DocumentForm({
  types,
  onClose,
}: {
  types: DocumentType[]
  onClose: () => void
}) {
  const upload = useUploadDocument()
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)

  const form = useForm<DocumentFormValues>({
    resolver: zodResolver(documentSchema),
    defaultValues: {
      label: '',
      type_id: null,
      country_code: null,
      number_last4: null,
      issued_on: null,
      expires_on: null,
      is_shared: true,
      notes: null,
    },
  })

  const typeId = form.watch('type_id')
  const selectedType = types.find((t) => t.id === typeId)

  const onSubmit = form.handleSubmit(async (values) => {
    if (selectedType?.requires_country && !values.country_code) {
      form.setError('country_code', { message: `A ${selectedType.name} needs a country` })
      return
    }
    await upload.mutateAsync({ meta: values, file })
    onClose()
  })

  const onPickFile = (picked: File | null) => {
    setFileError(null)
    if (!picked) return setFile(null)
    if (picked.size > MAX_DOCUMENT_BYTES) {
      setFileError(`That's ${formatBytes(picked.size)} — the limit is 10 MB.`)
      return
    }
    if (!ACCEPTED_MIME_TYPES.includes(picked.type as (typeof ACCEPTED_MIME_TYPES)[number])) {
      setFileError('PDFs and images only.')
      return
    }
    setFile(picked)
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="What is it?" error={form.formState.errors.label?.message} htmlFor="doc-label">
        <Input id="doc-label" autoFocus placeholder="My passport" {...form.register('label')} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type" htmlFor="doc-type">
          <Select id="doc-type" {...form.register('type_id')}>
            <option value="">Unspecified</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={selectedType?.requires_country ? 'Country' : 'Country (optional)'}
          hint="Two-letter code, e.g. PT"
          error={form.formState.errors.country_code?.message}
          htmlFor="doc-country"
        >
          <Input id="doc-country" maxLength={2} className="uppercase" {...form.register('country_code')} />
        </Field>
      </div>

      {selectedType?.has_expiry !== false && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Issued" htmlFor="doc-issued">
            <Input id="doc-issued" type="date" {...form.register('issued_on')} />
          </Field>
          <Field
            label="Expires"
            hint="Drives the reminders"
            error={form.formState.errors.expires_on?.message}
            htmlFor="doc-expires"
          >
            <Input id="doc-expires" type="date" {...form.register('expires_on')} />
          </Field>
        </div>
      )}

      <Field
        label="Last 4 digits"
        hint="Only ever the last four — the full number is never stored"
        error={form.formState.errors.number_last4?.message}
        htmlFor="doc-last4"
      >
        <Input id="doc-last4" maxLength={4} inputMode="numeric" {...form.register('number_last4')} />
      </Field>

      <div className="space-y-1.5">
        <span className="text-sm font-medium">File</span>
        <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground hover:bg-secondary/50">
          <Upload className="size-4" aria-hidden="true" />
          {file ? `${file.name} · ${formatBytes(file.size)}` : 'Choose a PDF or photo (optional)'}
          <input
            type="file"
            className="sr-only"
            accept={ACCEPTED_MIME_TYPES.join(',')}
            onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
          />
        </label>
        {fileError && (
          <p className="text-xs text-destructive" role="alert">
            {fileError}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Stored in a private bucket. Opened through links that expire after five minutes.
        </p>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5 size-4" {...form.register('is_shared')} />
        <span>
          Share with your partner
          <span className="block text-xs text-muted-foreground">
            Untick and it stays yours alone — they will not be able to see it at all.
          </span>
        </span>
      </label>

      <Field label="Notes" htmlFor="doc-notes">
        <Textarea id="doc-notes" rows={2} {...form.register('notes')} />
      </Field>

      {upload.error ? (
        <p className="text-sm text-destructive" role="alert">
          {userMessage(upload.error)}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" disabled={upload.isPending}>
          {upload.isPending ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
