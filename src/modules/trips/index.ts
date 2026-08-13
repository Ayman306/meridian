/** Public surface of the trips module. */
export { TripListPage } from './pages/TripListPage'
export { NewTripPage } from './pages/NewTripPage'
export { TripDetailPage } from './pages/TripDetailPage'
export {
  useTrip,
  useTrips,
  useTripStatuses,
  useTripRealtime,
  useCreateTrip,
  useUpdateTrip,
  useSetTripDates,
  useSetTravelerDates,
  useSetDayType,
  useDeleteTrip,
  useRestoreTrip,
} from './hooks'
export {
  countdownDays,
  diffTripDays,
  formatTripDates,
  groupTrips,
  isLongStay,
  nextDayType,
  nights,
  days,
  overlappingTrips,
  togetherWindow,
  tripGroup,
  GROUP_LABELS,
} from './logic'
export type {
  DatePrecision,
  DayType,
  TogetherWindow,
  Trip,
  TripDay,
  TripDetail,
  TripGroup,
  TripStatus,
  TripSummary,
  TripTraveler,
} from './types'
