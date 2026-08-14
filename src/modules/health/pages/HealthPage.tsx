/**
 * Own health home. Spec 12.5.
 *
 * Sections rather than five separate routes: the spec lists /health/cycle,
 * /health/medications and /health/sharing as distinct screens, and they are
 * distinct *panels* here, reachable by tab. The reason is spec 12.6's rule
 * about no analytics on any health route — one route is one thing to keep
 * clean, and a person's URL history stops saying which part of this they were
 * reading.
 */
'use client'

import { useState } from 'react'
import { Download, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { PageHeader } from '@/components/layout/PageHeader'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { EmptyState } from '@/components/common/states'
import { cn } from '@/lib/utils'
import { useAuth } from '@/providers/AuthProvider'
import { useCouple } from '@/providers/CoupleProvider'
import { CyclePanel } from '../components/CyclePanel'
import { MedicationsPanel } from '../components/MedicationsPanel'
import { SharingPanel } from '../components/SharingPanel'
import { PartnerView } from '../components/PartnerView'
import { HEALTH_DISCLAIMER } from '../logic'
import { useDeleteAllHealthData } from '../hooks'
import * as api from '../api'

type Tab = 'cycle' | 'records' | 'sharing' | 'partner'

const TABS: { value: Tab; label: string }[] = [
  { value: 'cycle', label: 'Cycle' },
  { value: 'records', label: 'Records' },
  { value: 'sharing', label: 'Sharing' },
  { value: 'partner', label: 'Theirs' },
]

export function HealthPage() {
  const { user } = useAuth()
  const { partnerRef, isSolo } = useCouple()
  const deleteAll = useDeleteAllHealthData()

  const [tab, setTab] = useState<Tab>('cycle')
  const [confirming, setConfirming] = useState(false)

  if (!user) return <EmptyState title="Sign in to see this" />

  const download = async () => {
    const blob = await api.exportHealthData(user.id)
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'meridian-health.json'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4 pb-12">
      <PageHeader
        title="Health"
        description="Yours. Nothing here is shared until you share it."
      />

      <div className="flex gap-1 overflow-x-auto border-b border-border" role="tablist">
        {TABS.filter((t) => t.value !== 'partner' || (!isSolo && partnerRef)).map((option) => (
          <button
            key={option.value}
            role="tab"
            aria-selected={tab === option.value}
            className={cn(
              '-mb-px shrink-0 border-b-2 px-4 py-2 text-sm',
              tab === option.value
                ? 'border-accent font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setTab(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {tab === 'cycle' && <CyclePanel ownerId={user.id} />}
      {tab === 'records' && <MedicationsPanel ownerId={user.id} />}
      {tab === 'sharing' && <SharingPanel />}
      {tab === 'partner' && partnerRef && <PartnerView partnerId={partnerRef.id} name={partnerRef.displayName} />}

      <Card className="space-y-3 p-5">
        <h2 className="text-sm font-medium">Your data</h2>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void download()}>
            <Download aria-hidden="true" />
            Export as JSON
          </Button>
          <Button variant="destructive" onClick={() => setConfirming(true)}>
            <Trash2 aria-hidden="true" />
            Delete all of it
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Deleting is immediate and permanent. There is no thirty-day bin for this, unlike the rest
          of the app — health data that lingers after somebody deleted it is not deleted.
        </p>
      </Card>

      <p className="text-xs text-muted-foreground">{HEALTH_DISCLAIMER}</p>

      <ConfirmDialog
        open={confirming}
        title="Delete all your health data?"
        description="Every cycle log, medication, vaccination and sharing setting. Immediately, permanently, and with no way to undo it. Export first if you want a copy."
        confirmLabel="Delete everything"
        typeToConfirm="DELETE"
        destructive
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          deleteAll.mutate()
          setConfirming(false)
        }}
      />
    </div>
  )
}
