'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { qk } from '@/lib/queryClient'
import { useAuth } from '@/providers/AuthProvider'
import { useCouple } from '@/providers/CoupleProvider'
import { SIGNED_URL_TTL_SECONDS } from '@/lib/constants'
import * as api from './api'
import type { UpdateDto } from '@/types/database'

export function useDocumentTypes() {
  const { coupleId } = useCouple()
  return useQuery({
    queryKey: qk.documentTypes,
    queryFn: () => api.listDocumentTypes(coupleId!),
    enabled: Boolean(coupleId),
    staleTime: 10 * 60_000,
  })
}

export function useDocuments() {
  const { coupleId } = useCouple()
  return useQuery({
    queryKey: qk.documents(coupleId ?? 'none'),
    queryFn: () => api.listDocuments(coupleId!),
    enabled: Boolean(coupleId),
  })
}

export function useDocument(id: string | undefined) {
  return useQuery({
    queryKey: qk.document(id ?? 'none'),
    queryFn: () => api.getDocument(id!),
    enabled: Boolean(id),
  })
}

export function useUploadDocument() {
  const qc = useQueryClient()
  const { coupleId } = useCouple()
  const { user } = useAuth()

  return useMutation({
    mutationFn: ({ meta, file }: { meta: api.DocumentMeta; file: File | null }) =>
      api.uploadDocument(coupleId!, user!.id, meta, file),
    onSuccess: () => invalidate(qc),
  })
}

export function useUpdateDocument() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateDto<'documents'> }) =>
      api.updateDocument(id, patch),
    onSuccess: (doc) => {
      void qc.invalidateQueries({ queryKey: qk.document(doc.id) })
      void invalidate(qc)
    },
  })
}

export function useDeleteDocument() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteDocument(id),
    onSuccess: () => invalidate(qc),
  })
}

/**
 * A signed URL for one file.
 *
 * Cached for slightly less than its own lifetime so a re-render does not mint
 * a new one, and refetched before it expires so an open viewer does not
 * suddenly 403.
 */
export function useSignedUrl(storagePath: string | null | undefined) {
  return useQuery({
    queryKey: ['signed-url', storagePath ?? 'none'],
    queryFn: () => api.getSignedUrl(storagePath!),
    enabled: Boolean(storagePath),
    staleTime: (SIGNED_URL_TTL_SECONDS - 30) * 1000,
    gcTime: SIGNED_URL_TTL_SECONDS * 1000,
    refetchOnWindowFocus: false,
  })
}

export function useTripReadiness(tripId: string | undefined) {
  return useQuery({
    queryKey: qk.readiness(tripId ?? 'none'),
    queryFn: () => api.getTripReadiness(tripId!),
    enabled: Boolean(tripId),
  })
}

export function useAddRequirement(tripId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ userId, typeId }: { userId: string; typeId: string }) =>
      api.addRequirement(tripId, userId, typeId),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.readiness(tripId) }),
  })
}

export function useRemoveRequirement(tripId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ userId, typeId }: { userId: string; typeId: string }) =>
      api.removeRequirement(tripId, userId, typeId),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.readiness(tripId) }),
  })
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'documents' })
  void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'readiness' })
  // An expiry the dashboard is warning about may have just been fixed.
  void qc.invalidateQueries({ queryKey: qk.dashboard })
}
