/** Public surface of the wishlist module. */
export { WishlistPage } from './pages/WishlistPage'
export { BlendPage } from './pages/BlendPage'
export {
  useWishlist,
  useWishlistRealtime,
  useAddWishlistItem,
  useUpdateWishlistItem,
  useDeleteWishlistItem,
  useSetVerdict,
  usePushToItinerary,
  useSaveDraft,
  useExtractFromUrl,
} from './hooks'
export {
  applyPacing,
  balanceAuthorship,
  buildBlend,
  clusterByLocation,
  generateDraft,
  groupByCity,
  isSamePlace,
  normaliseTitle,
  orderByProximity,
  pickSpreadDays,
} from './logic'
export type {
  BlendGroups,
  Draft,
  DraftDay,
  DraftOptions,
  MatchedPair,
  Pace,
  Verdict,
  WishlistItem,
  WishlistItemWithVerdicts,
  WishlistVerdict,
} from './types'
