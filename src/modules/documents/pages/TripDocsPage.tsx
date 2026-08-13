'use client'

import { useParams } from 'next/navigation'
import { useTrip } from '@/modules/trips'
import { SkeletonList } from '@/components/common/states'
import { TripReadiness } from '../components/TripReadiness'

export function TripDocsPage() {
  const params = useParams<{ id: string }>()
  const { data: trip } = useTrip(params.id)

  if (!trip) return <SkeletonList rows={2} />

  return <TripReadiness tripId={trip.id} tripEnd={trip.end_date ?? trip.start_date} />
}
