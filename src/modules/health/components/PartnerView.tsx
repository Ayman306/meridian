/**
 * What the other person has chosen to share. Spec 12.5, `/health/partner`.
 *
 * Spec 12.6: "Partner's view is read-only and **visibly limited** — show what
 * isn't shared, not a seamless illusion." So this deliberately lists the
 * scopes that are *not* shared alongside the ones that are, rather than
 * quietly rendering a shorter page. A view that hid the gaps would let someone
 * mistake "nothing logged" for "nothing shared", which is exactly the
 * confusion that turns into pressure.
 *
 * It cannot tell which scopes were granted — `health_consents` is readable
 * only by its owner (0014), and deliberately so: "what does my partner track?"
 * is not a question this app answers. So it infers from what came back, and
 * says as much.
 */
'use client'

import { EyeOff, Lock } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { SkeletonList } from '@/components/common/states'
import { useCycles, useHealthRecords } from '../hooks'
import { CyclePanel } from './CyclePanel'
import { MedicationsPanel } from './MedicationsPanel'

export function PartnerView({ partnerId, name }: { partnerId: string; name: string }) {
  // Both queries go through RLS. Empty means "not shared, or nothing logged",
  // and the copy below never pretends to know which.
  const cycles = useCycles(partnerId)
  const records = useHealthRecords(partnerId)

  if (cycles.isLoading || records.isLoading) return <SkeletonList rows={3} />

  const hasCycles = (cycles.data?.length ?? 0) > 0
  const hasRecords = (records.data?.length ?? 0) > 0

  return (
    <div className="space-y-4">
      <Card className="flex items-start gap-2 p-4">
        <EyeOff className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">
          Read-only. You see what {name} has chosen to share and nothing else, and they can stop
          sharing any of it at any time without telling you.
        </p>
      </Card>

      {hasCycles ? (
        <section className="space-y-2">
          <h3 className="text-sm font-medium">Cycle</h3>
          <CyclePanel ownerId={partnerId} readOnly />
        </section>
      ) : (
        <NotShared label="Cycle" name={name} />
      )}

      {hasRecords ? (
        <section className="space-y-2">
          <h3 className="text-sm font-medium">Records</h3>
          <MedicationsPanel ownerId={partnerId} readOnly />
        </section>
      ) : (
        <NotShared label="Medications and records" name={name} />
      )}
    </div>
  )
}

/**
 * The visible gap. Worded so it cannot be read as an accusation or a prompt —
 * spec 12.2 forbids notification pressure on the owner, and a partner-facing
 * "ask them to share this" button would be exactly that with extra steps.
 */
function NotShared({ label, name }: { label: string; name: string }) {
  return (
    <Card className="flex items-start gap-2 border-dashed p-4">
      <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">
          Not shared, or nothing logged. {name} decides which, and the app does not say.
        </p>
      </div>
    </Card>
  )
}
