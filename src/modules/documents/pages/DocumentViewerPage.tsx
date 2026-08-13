'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Download, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { EmptyState, ErrorState, PageLoading, Skeleton } from '@/components/common/states'
import { useCouple } from '@/providers/CoupleProvider'
import { todayIn } from '@/lib/dates'
import { useDeleteDocument, useDocument, useSignedUrl, useUpdateDocument } from '../hooks'
import { expiryStatus, formatBytes, isImage, isPdf, maskNumber } from '../logic'
import { ExpiryBadge } from '../components/ExpiryBadge'

export function DocumentViewerPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { self, tzSelf } = useCouple()
  const { data: doc, isLoading, error, refetch } = useDocument(id)
  const update = useUpdateDocument()
  const remove = useDeleteDocument()
  const [confirmDelete, setConfirmDelete] = useState(false)

  if (isLoading) return <PageLoading />
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />
  if (!doc) {
    return (
      <EmptyState
        title="Not found"
        description="It may have been deleted, or made private by its owner."
        action={
          <Link href="/documents" className={buttonVariants()}>
            Back to the vault
          </Link>
        }
      />
    )
  }

  const isMine = doc.owner_id === self?.id
  const status = expiryStatus(doc.expires_on, {
    isPassport: doc.type?.name === 'Passport',
    against: todayIn(tzSelf),
  })

  return (
    <>
      <Link
        href="/documents"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Vault
      </Link>

      <PageHeader
        title={doc.label}
        description={[doc.type?.name, doc.country_code].filter(Boolean).join(' · ') || undefined}
        actions={
          isMine ? (
            <Button variant="ghost" size="icon" aria-label="Delete" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="text-destructive" aria-hidden="true" />
            </Button>
          ) : null
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <FilePreview
          storagePath={doc.storage_path}
          mimeType={doc.mime_type}
          fileName={doc.file_name}
        />

        <Card>
          <CardContent className="space-y-4 pt-5">
            <Detail label="Expires">
              <ExpiryBadge status={status} expiresOn={doc.expires_on} />
            </Detail>
            {doc.issued_on && <Detail label="Issued">{doc.issued_on}</Detail>}
            {doc.number_last4 && (
              <Detail label="Number">
                {/* Never the whole number, even to its owner. */}
                <span className="tabular">{maskNumber(doc.number_last4)}</span>
              </Detail>
            )}
            {doc.file_name && (
              <Detail label="File">
                {doc.file_name}
                <span className="ml-2 text-xs text-muted-foreground">
                  {formatBytes(doc.file_size)}
                </span>
              </Detail>
            )}
            {doc.notes && <Detail label="Notes">{doc.notes}</Detail>}

            {isMine && (
              <div className="border-t border-border pt-4">
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4"
                    checked={doc.is_shared}
                    onChange={(e) =>
                      update.mutate({ id: doc.id, patch: { is_shared: e.target.checked } })
                    }
                  />
                  <span>
                    Shared with your partner
                    <span className="block text-xs text-muted-foreground">
                      Unticking hides it from them straight away.
                    </span>
                  </span>
                </label>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete “${doc.label}”?`}
        description="It goes to the bin for 30 days. The file itself is removed by the sweep, not immediately, so this is recoverable."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          await remove.mutateAsync(doc.id)
          setConfirmDelete(false)
          router.push('/documents')
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  )
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  )
}

/**
 * The file itself, behind a signed URL that expires in five minutes. The URL
 * is fetched on demand and never stored — a bucket this app can read publicly
 * would defeat the point of the vault.
 */
function FilePreview({
  storagePath,
  mimeType,
  fileName,
}: {
  storagePath: string | null
  mimeType: string | null
  fileName: string | null
}) {
  const { data: url, isLoading, error, refetch } = useSignedUrl(storagePath)

  if (!storagePath) {
    return (
      <Card>
        <CardContent className="pt-5">
          <EmptyState
            subtle
            title="No file attached"
            description="The dates and details are recorded, but there's no scan or photo."
          />
        </CardContent>
      </Card>
    )
  }

  if (isLoading) return <Skeleton className="aspect-[3/4] w-full" />
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} title="Couldn't open the file" />
  if (!url) return null

  return (
    <Card className="overflow-hidden">
      {isImage(mimeType) ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={fileName ?? 'Document'} className="max-h-[70vh] w-full object-contain" />
      ) : isPdf(mimeType) ? (
        <iframe src={url} title={fileName ?? 'Document'} className="h-[70vh] w-full" />
      ) : (
        <CardContent className="pt-5">
          <EmptyState subtle title="Can't preview this type" />
        </CardContent>
      )}
      <CardContent className="pt-4">
        <a href={url} download={fileName ?? undefined} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          <Download aria-hidden="true" />
          Download
        </a>
      </CardContent>
    </Card>
  )
}
