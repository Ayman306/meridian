/** Public surface of the stay-allowance module. */
export { AllowancePage } from './pages/AllowancePage'
export { AllowanceWarning } from './components/AllowanceWarning'
export { TripAllowanceStrip } from './components/TripAllowanceStrip'
export { AdvisoryNote } from './components/AdvisoryNote'
export { RuleEditor } from './components/RuleEditor'
export { AllowanceBar } from './components/AllowanceBar'
export {
  useAllowanceRules,
  useAllowanceRealtime,
  useEntryLog,
  useLogEntry,
  useUpdateLogEntry,
  useDeleteLogEntry,
  useUpsertRule,
  useDeleteRule,
  useTripAllowanceCheck,
  useLogSuggestions,
} from './hooks'
export {
  ALLOWANCE_DISCLAIMER,
  TIGHT_HEADROOM_DAYS,
  checkPlannedStay,
  daysUsedOn,
  daysUsedBetween,
  describeRule,
  findOverlaps,
  mergeStays,
  mustLeaveBy,
  ruleFor,
  staysForRule,
  statusFor,
  suggestFromTrip,
  usedOnFor,
} from './logic'
export type {
  AllowanceCheck,
  AllowanceRule,
  AllowanceStatus,
  CheckVerdict,
  EntryExitLog,
  LogSuggestion,
  RuleType,
  Stay,
} from './types'
