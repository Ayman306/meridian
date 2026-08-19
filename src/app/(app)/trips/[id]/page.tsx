import { TripJourneyPage } from '@/modules/trips'

/**
 * The trip's front page.
 *
 * This used to redirect to the plan, which meant the first thing a trip showed
 * was a list to fill in. It now shows the trip itself — where it goes, what is
 * already on it, which day is next — and the plan is one tab away.
 */
export default function TripIndex() {
  return <TripJourneyPage />
}
