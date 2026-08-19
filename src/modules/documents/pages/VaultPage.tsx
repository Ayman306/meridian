'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { EyeOff, FileText, Plus } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select } from '@/components/ui/input'
import { EmptyState, ErrorState, SkeletonList } from '@/components/common/states'
import { PersonBadge } from '@/components/PersonBadge'
import { useCouple } from '@/providers/CoupleProvider'
import { useAuth } from '@/providers/AuthProvider'
import { useUserSettings } from '@/modules/settings'
import { todayIn } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { useDocuments, useDocumentTypes } from '../hooks'
import { byUrgency, expiryStatus, isActionable, maskNumber } from '../logic'
import { ExpiryBadge } from '../components/ExpiryBadge'
import { DocumentForm } from '../components/DocumentForm'
import { VaultGate } from '../components/VaultGate'
import type { DocumentWithType } from '../types'

type Filter = 'all' | 'mine' | 'theirs' | 'expiring'

export function VaultPage() {
  const { self, partner, selfRef, partnerRef, tzSelf } = useCouple()
  const documents = useDocuments()
  const types = useDocumentTypes()
  const settings = useUserSettings()
  const { signOut } = useAuth()
  const [filter, setFilter] = useState<Filter>('all')
  const [adding, setAdding] = useState(false)

  const today = todayIn(tzSelf)

  const groups = useMemo(() => {
    const docs = documents.data ?? []
    const withStatus = docs.map((doc) => ({
      doc,
      status: expiryStatus(doc.expires_on, {
        isPassport: doc.type?.name === 'Passport',
        against: today,
      }),
    }))

    const filtered = withStatus.filter(({ doc, status }) => {
      if (filter === 'mine') return doc.owner_id === self?.id
      if (filter === 'theirs') return doc.owner_id !== self?.id
      if (filter === 'expiring') return isActionable(status.level)
      return true
    })

    // Grouped by owner, then most urgent first within each — the order you
    // actually want when you open this a week before a trip.
    const byOwner = new Map<string, typeof filtered>()
    for (const entry of filtered) {
      const list = byOwner.get(entry.doc.owner_id) ?? []
      list.push(entry)
      byOwner.set(entry.doc.owner_id, list)
    }
    for (const list of byOwner.values()) {
      list.sort((a, b) => byUrgency(a.status.level, b.status.level))
    }
    return byOwner
  }, [documents.data, filter, self?.id, today])

  const owners = [self, partner].filter((p) => p !== null)

  return (
    <VaultGate lockMinutes={settings.data?.vault_lock_minutes} onSignOut={() => void signOut()}>
      <PageHeader
        title="Documents"
        description="Passports, visas and the dates that matter. Private by default to whoever owns them."
        actions={
          <Button onClick={() => setAdding((v) => !v)}>
            <Plus aria-hidden="true" />
            Add
          </Button>
        }
      />

      {adding && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">New document</CardTitle>
          </CardHeader>
          <CardContent>
            <DocumentForm types={types.data ?? []} onClose={() => setAdding(false)} />
          </CardContent>
        </Card>
      )}

      <div className="mb-4 flex items-center gap-2">
        <Select
          aria-label="Filter documents"
          className="h-9 w-auto"
          value={filter}
          onChange={(e) => setFilter(e.target.value as Filter)}
        >
          <option value="all">Everything</option>
          <option value="mine">Mine</option>
          <option value="theirs">{partner?.display_name ?? 'Partner'}&apos;s</option>
          <option value="expiring">Needs attention</option>
        </Select>
      </div>

      {documents.isLoading && <SkeletonList rows={3} />}
      {documents.error && (
        <ErrorState error={documents.error} onRetry={() => void documents.refetch()} />
      )}

      {!documents.isLoading && !documents.error && (documents.data?.length ?? 0) === 0 && (
        <EmptyState
          title="Nothing in the vault yet"
          description="Add a passport and you'll be warned long before it becomes a problem."
          icon={<FileText className="size-6" aria-hidden="true" />}
          action={<Button onClick={() => setAdding(true)}>Add your first document</Button>}
        />
      )}

      <div className="space-y-8">
        {owners.map((owner) => {
          const entries = groups.get(owner.id) ?? []
          if (entries.length === 0) return null
          const ref = owner.id === self?.id ? selfRef : partnerRef

          return (
            <section key={owner.id}>
              <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <PersonBadge person={ref} size="xs" />
                {owner.id === self?.id ? 'Yours' : `${owner.display_name ?? 'Partner'}'s`}
              </h2>
              <div className="space-y-2">
                {entries.map(({ doc, status }) => (
                  <DocumentRow key={doc.id} doc={doc} status={status} isMine={doc.owner_id === self?.id} />
                ))}
              </div>
            </section>
          )
        })}
      </div>
    </VaultGate>
  )
}

function DocumentRow({
  doc,
  status,
  isMine,
}: {
  doc: DocumentWithType
  status: ReturnType<typeof expiryStatus>
  isMine: boolean
}) {
  return (
    <Card className={cn(isActionable(status.level) && 'border-[hsl(var(--warn))]/40')}>
      <Link href={`/documents/${doc.id}`} className="flex items-center gap-3 rounded-lg p-4">
        <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{doc.label}</span>
            {isMine && !doc.is_shared && (
              <span
                className="inline-flex items-center gap-1 text-xs text-muted-foreground"
                title="Only you can see this"
              >
                <EyeOff className="size-3" aria-hidden="true" />
                Private
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
            {doc.type?.name && <span>{doc.type.name}</span>}
            {doc.country_code && <span>{doc.country_code}</span>}
            {doc.number_last4 && <span className="tabular">{maskNumber(doc.number_last4)}</span>}
          </div>
        </div>
        <ExpiryBadge status={status} expiresOn={doc.expires_on} />
      </Link>
    </Card>
  )
}
