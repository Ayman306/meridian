/** Presentation helpers shared by the dashboard's components. */
import { formatInZone as formatInZoneBase } from '@/lib/dates'
import { haversineKm } from '@/lib/utils'

export const formatInZone = formatInZoneBase

/**
 * Distance between two home cities, or null when either is unknown.
 *
 * Coordinates come out of Postgres `numeric`, which supabase-js hands back as
 * a number — but a profile that skipped geocoding has none at all, and the
 * dashboard should quietly omit the figure rather than render NaN.
 */
export function haversineKmSafe(
  aLat: number | null | undefined,
  aLng: number | null | undefined,
  bLat: number | null | undefined,
  bLng: number | null | undefined,
): number | null {
  if (
    aLat === null ||
    aLat === undefined ||
    aLng === null ||
    aLng === undefined ||
    bLat === null ||
    bLat === undefined ||
    bLng === null ||
    bLng === undefined
  ) {
    return null
  }
  return haversineKm({ lat: Number(aLat), lng: Number(aLng) }, { lat: Number(bLat), lng: Number(bLng) })
}
