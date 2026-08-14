import { TripMoneyPage } from '@/modules/budget'
import { createServerSupabase } from '@/lib/supabase/server'

export default async function TripMoney({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  // The trip's dates decide the per-day average and the per-week view, and the
  // summary is wrong without them — averaging over the days that happen to
  // have expenses flatters the number. Read here so the client does not have
  // to wait on a second round trip before it can render anything.
  const supabase = await createServerSupabase()
  const { data: trip } = await supabase
    .from('trips')
    .select('title, start_date, end_date')
    .eq('id', id)
    .maybeSingle()

  const range =
    trip?.start_date && trip.end_date ? { start: trip.start_date, end: trip.end_date } : null

  return <TripMoneyPage tripId={id} tripTitle={trip?.title ?? undefined} range={range} />
}
