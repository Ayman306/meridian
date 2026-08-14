import { WherePage } from '@/modules/destinations'

export default async function TripWhere({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <WherePage tripId={id} />
}
