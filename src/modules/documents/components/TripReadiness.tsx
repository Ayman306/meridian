'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { Check, Plus, X } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select } from '@/components/ui/input'
import { ErrorState, SkeletonList } from '@/components/common/states'
import { PersonBadge } from '@/components/PersonBadge'
import { useCouple } from '@/providers/CoupleProvider'
import { cn } from '@/lib/utils'
import {
  useAddRequirement,
  useDocumentTypes,
  useRemoveRequirement,
  useTripReadiness,
} from '../hooks'
import { buildReadiness, isReady, readinessFraction } from '../logic'

/**
 * Per-person readiness for one trip.
 *
 * The score is computed in SQL against the trip's *end date*, not today — a
 * passport that expires mid-trip does not count as satisfying the requirement,
 * and getting that wrong would tell someone they were ready when they weren't.
 */
export function TripReadiness({ tripId, tripEnd }: { tripId: string; tripEnd: string | null }) {
  const { self, partner, selfRef, partnerRef } = useCouple()
  const readiness = useTripReadiness(tripId)
  const types = useDocumentTypes()
  const addRequirement = useAddRequirement(tripId)
  const removeRequirement = useRemoveRequirement(tripId)

  const reports = useMemo(() => buildReadiness(readiness.data ?? []), [readiness.data])
  const people = [
    { profile: self, ref: selfRef, isSelf: true },
    { profile: partner, ref: partnerRef, isSelf: false },
  ].filter((p) => p.profile !== null)

  if (readiness.isLoading) return <SkeletonList rows={2} />
  if (readiness.error) {
    return <ErrorState error={readiness.error} onRetry={() => void readiness.refetch()} />
  }

  return (
    <div className="space-y-4">
      {tripEnd && (
        <p className="text-sm text-muted-foreground">
          Checked against {tripEnd} — the day the trip ends, not today. A document that expires
          mid-trip doesn&apos;t count.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {people.map(({ profile, ref, isSelf }) => {
          const report = reports[profile!.id]
          const ready = report ? isReady(report) : false

          return (
            <Card key={profile!.id}>
              <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <PersonBadge person={ref} size="xs" />
                  {isSelf ? 'You' : (profile!.display_name ?? 'Partner')}
                </CardTitle>
                <span
                  className={cn(
                    'tabular text-sm font-medium',
                    ready ? 'text-[hsl(var(--ok))]' : 'text-[hsl(var(--warn))]',
                  )}
                >
                  {report ? readinessFraction(report) : '0 / 0'}
                </span>
              </CardHeader>

              <CardContent className="space-y-2">
                {(report?.required ?? []).map((row) => (
                  <div key={row.type_id} className="flex items-center gap-2 text-sm">
                    {row.satisfied ? (
                      <Check className="size-4 shrink-0 text-[hsl(var(--ok))]" aria-hidden="true" />
                    ) : (
                      <X className="size-4 shrink-0 text-[hsl(var(--warn))]" aria-hidden="true" />
                    )}
                    <span className={cn('flex-1', !row.satisfied && 'text-muted-foreground')}>
                      {row.type_name}
                    </span>
                    {row.satisfied && row.expires_on && (
                      <span className="text-xs text-muted-foreground">until {row.expires_on}</span>
                    )}
                    {row.is_manual && isSelf && (
                      <button
                        aria-label={`Remove ${row.type_name}`}
                        className="rounded text-muted-foreground/60 hover:text-destructive"
                        onClick={() =>
                          removeRequirement.mutate({ userId: profile!.id, typeId: row.type_id })
                        }
                      >
                        <X className="size-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                ))}

                {report && report.missing.length > 0 && (
                  <p className="pt-1 text-xs text-muted-foreground">
                    Missing: {report.missing.join(', ')}.{' '}
                    <Link href="/documents" className="underline underline-offset-2">
                      Add to the vault
                    </Link>
                  </p>
                )}

                {isSelf && (
                  <div className="flex items-center gap-2 pt-2">
                    <Select
                      aria-label="Add a requirement"
                      className="h-8 flex-1 text-xs"
                      defaultValue=""
                      onChange={(e) => {
                        if (!e.target.value) return
                        addRequirement.mutate({ userId: profile!.id, typeId: e.target.value })
                        e.target.value = ''
                      }}
                    >
                      <option value="">Also need…</option>
                      {(types.data ?? [])
                        .filter((t) => !report?.required.some((r) => r.type_id === t.id))
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                    </Select>
                    <Plus className="size-4 text-muted-foreground" aria-hidden="true" />
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
