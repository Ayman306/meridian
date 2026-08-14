import { FlightLivePage } from '@/modules/flights'

export default async function FlightLive({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <FlightLivePage flightId={id} />
}
