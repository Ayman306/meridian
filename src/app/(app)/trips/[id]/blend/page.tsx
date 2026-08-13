import { BlendPage } from '@/modules/wishlist'

export default async function TripBlend({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <BlendPage tripId={id} />
}
