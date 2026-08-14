import { TripFlightsPage } from '@/modules/flights'

export default async function TripFlights({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <TripFlightsPage tripId={id} />
}
