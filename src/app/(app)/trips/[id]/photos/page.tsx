import { GalleryPage } from '@/modules/gallery'

export default async function TripPhotos({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <GalleryPage tripId={id} />
}
