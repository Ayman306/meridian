import { TripDetailPage } from '@/modules/trips'

/**
 * The trip header, tabs and traveler dates persist across the tab routes, so
 * they live in a layout rather than being re-rendered by each tab.
 */
export default function TripLayout({ children }: { children: React.ReactNode }) {
  return <TripDetailPage>{children}</TripDetailPage>
}
