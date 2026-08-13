/** Module 8 — Documents. Supabase access only. */
'use client'

import { supabase } from '@/lib/supabase/client'
import { toAppError, unwrap, unwrapList } from '@/lib/errors'
import { AppError } from '@/lib/errors'
import { MAX_DOCUMENT_BYTES, SIGNED_URL_TTL_SECONDS } from '@/lib/constants'
import type { DateOnly } from '@/lib/dates'
import { ACCEPTED_MIME_TYPES, sanitiseFileName, storagePath } from './logic'
import type { DocumentType, DocumentWithType, RequirementRow, TravelDocument } from './types'
import type { UpdateDto } from '@/types/database'

const BUCKET = 'docs'

export async function listDocumentTypes(coupleId: string): Promise<DocumentType[]> {
  const rows = unwrapList(
    await supabase
      .from('document_types')
      .select('*')
      .eq('couple_id', coupleId)
      .order('sort_order', { ascending: true }),
  )
  if (rows.length > 0) return rows

  const { error } = await supabase.rpc('seed_document_types', { target: coupleId })
  if (error) throw toAppError(error)
  return unwrapList(
    await supabase
      .from('document_types')
      .select('*')
      .eq('couple_id', coupleId)
      .order('sort_order', { ascending: true }),
  )
}

/**
 * Everything the viewer is allowed to see: their own, plus the partner's
 * shared ones. The filtering is RLS's job, not ours — this is a plain select.
 */
export async function listDocuments(coupleId: string): Promise<DocumentWithType[]> {
  const [docs, types] = await Promise.all([
    unwrapList(
      await supabase
        .from('documents')
        .select('*')
        .eq('couple_id', coupleId)
        .is('deleted_at', null)
        .order('expires_on', { ascending: true, nullsFirst: false }),
    ),
    listDocumentTypes(coupleId),
  ])

  const typeById = new Map(types.map((t) => [t.id, t]))
  return docs.map((d) => ({ ...d, type: d.type_id ? (typeById.get(d.type_id) ?? null) : null }))
}

export async function getDocument(id: string): Promise<DocumentWithType | null> {
  const doc = unwrapList(await supabase.from('documents').select('*').eq('id', id).limit(1))[0]
  if (!doc) return null

  const type = doc.type_id
    ? unwrapList(await supabase.from('document_types').select('*').eq('id', doc.type_id).limit(1))[0]
    : undefined

  return { ...doc, type: type ?? null }
}

export interface DocumentMeta {
  label: string
  type_id?: string | null
  country_code?: string | null
  number_last4?: string | null
  issued_on?: DateOnly | null
  expires_on?: DateOnly | null
  is_shared?: boolean
  notes?: string | null
}

/**
 * Create the metadata row, then upload the file into the path derived from its
 * id, then record the path.
 *
 * Order matters. The storage path contains the document id, so the row has to
 * exist first — and if the upload then fails we delete the row we just made,
 * because spec 8.7 requires no orphan rows and no orphan objects either way.
 */
export async function uploadDocument(
  coupleId: string,
  ownerId: string,
  meta: DocumentMeta,
  file: File | null,
): Promise<TravelDocument> {
  if (file) assertUploadable(file)

  const created = unwrap(
    await supabase
      .from('documents')
      .insert({
        couple_id: coupleId,
        owner_id: ownerId,
        label: meta.label,
        type_id: meta.type_id ?? null,
        country_code: meta.country_code ?? null,
        number_last4: meta.number_last4 ?? null,
        issued_on: meta.issued_on ?? null,
        expires_on: meta.expires_on ?? null,
        is_shared: meta.is_shared ?? true,
        notes: meta.notes ?? null,
      })
      .select('*')
      .single(),
  )

  if (!file) return created

  const path = storagePath(coupleId, ownerId, created.id, file.name)
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false })

  if (uploadError) {
    // Roll the row back rather than leaving a document that claims to have a
    // file it does not have.
    await supabase.from('documents').delete().eq('id', created.id)
    throw toAppError(uploadError)
  }

  return unwrap(
    await supabase
      .from('documents')
      .update({
        storage_path: path,
        file_name: sanitiseFileName(file.name),
        file_size: file.size,
        mime_type: file.type,
      })
      .eq('id', created.id)
      .select('*')
      .single(),
  )
}

function assertUploadable(file: File): void {
  if (file.size > MAX_DOCUMENT_BYTES) {
    throw new AppError('That file is over 10 MB. Try a smaller scan or a photo.', {
      kind: 'validation',
      retryable: false,
    })
  }
  if (!ACCEPTED_MIME_TYPES.includes(file.type as (typeof ACCEPTED_MIME_TYPES)[number])) {
    throw new AppError('Only PDFs and images can be stored here.', {
      kind: 'validation',
      retryable: false,
    })
  }
}

export async function updateDocument(
  id: string,
  patch: UpdateDto<'documents'>,
): Promise<TravelDocument> {
  return unwrap(await supabase.from('documents').update(patch).eq('id', id).select('*').single())
}

/**
 * A short-lived signed URL. Never a public bucket, never a long expiry — 300
 * seconds is enough to open a document and not enough to be worth sharing.
 */
export async function getSignedUrl(storagePathValue: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePathValue, SIGNED_URL_TTL_SECONDS)
  if (error) throw toAppError(error)
  if (!data?.signedUrl) throw new AppError('Could not open that file.', { kind: 'unknown' })
  return data.signedUrl
}

/**
 * Soft delete. The storage object survives until the 30-day sweep, so an
 * accidental delete is recoverable in full rather than as metadata only.
 */
export async function deleteDocument(id: string): Promise<void> {
  const { error } = await supabase
    .from('documents')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw toAppError(error)
}

export async function restoreDocument(id: string): Promise<void> {
  const { error } = await supabase.from('documents').update({ deleted_at: null }).eq('id', id)
  if (error) throw toAppError(error)
}

export async function getTripReadiness(tripId: string): Promise<RequirementRow[]> {
  const { data, error } = await supabase.rpc('trip_readiness', { target: tripId })
  if (error) throw toAppError(error)
  return (data ?? []) as RequirementRow[]
}

export async function addRequirement(
  tripId: string,
  userId: string,
  typeId: string,
): Promise<void> {
  const { error } = await supabase
    .from('trip_document_requirements')
    .upsert(
      { trip_id: tripId, user_id: userId, type_id: typeId, is_manual: true },
      { onConflict: 'trip_id,user_id,type_id' },
    )
  if (error) throw toAppError(error)
}

export async function removeRequirement(
  tripId: string,
  userId: string,
  typeId: string,
): Promise<void> {
  const { error } = await supabase
    .from('trip_document_requirements')
    .delete()
    .eq('trip_id', tripId)
    .eq('user_id', userId)
    .eq('type_id', typeId)
  if (error) throw toAppError(error)
}
