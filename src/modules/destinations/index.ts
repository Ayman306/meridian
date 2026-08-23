/** Public surface of the destinations module. */
export { WherePage } from './pages/WherePage'
export {
  useChosenCountry,
  useDestinations,
  useDestinationsRealtime,
  useAddCandidate,
  useUpdateDestination,
  useRemoveDestination,
  useChooseDestination,
  useWeights,
  useSaveWeights,
} from './hooks'
export {
  VISA_DISCLAIMER,
  VISA_FRICTION,
  VISA_TIER_LABELS,
  ZERO_WEIGHTS,
  bandFor,
  bestVisaRule,
  buildBoard,
  chosenDestination,
  combinedFriction,
  exclusionReason,
  fairness,
  findVisaRule,
  flightEstimate,
  isEqualDistance,
  normalise,
  parseWeights,
  rankColumns,
  scoreColumns,
  scoringEnabled,
  sortDestinations,
  tripMonth,
} from './logic'
export { seasonBand, BAND_LABELS } from './climate'
export { costBand, COST_LABELS } from './cost'
export type {
  BoardColumn,
  DestinationState,
  Fairness,
  FlightEstimate,
  PersonView,
  ScoreBreakdown,
  ScoreWeights,
  TripDestination,
  VisaRule,
  VisaTier,
} from './types'
