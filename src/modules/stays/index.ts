/** Public surface of the stays module. */
export { StaysPanel } from './components/StaysPanel'
export { useStays, useStaysRealtime, useAddStay, useUpdateStay, useRemoveStay } from './hooks'
export {
  KIND_LABELS,
  describeStay,
  isCheckoutDay,
  nightsAt,
  overlappingStays,
  sortStays,
  stayOn,
  uncoveredNights,
} from './logic'
export type { Accommodation, StayGap, StayKind, StayOverlap } from './types'
