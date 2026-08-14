import { TripMapPage } from '@/modules/map'

export default async function TripMap({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <TripMapPage tripId={id} />
}
