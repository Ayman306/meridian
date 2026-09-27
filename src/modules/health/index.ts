/** Public surface of the health module. Other modules import only from here. */
export { HealthPage } from './pages/HealthPage'
export { MedicationsPanel } from './components/MedicationsPanel'
export { CycleCalendar } from './components/CycleCalendar'
export { IntimacyPanel } from './components/IntimacyPanel'
export { WellnessPanel } from './components/WellnessPanel'
export {
  useConsents,
  useCycleWindow,
  useIntimacy,
  useWellnessTips,
  useHealthRecords,
  usePrediction,
  useRestrictions,
} from './hooks'
export {
  FERTILITY_DISCLAIMER,
  HEALTH_DISCLAIMER,
  NOT_CHECKED,
  calendarMarks,
  describeDayMark,
  describeProjectedCycle,
  monthGrid,
  monthOf,
  predictCycles,
  shiftMonth,
  checkSupply,
  describePrediction,
  describeSupply,
  hasConsent,
  showsCycle,
  matchRestrictions,
  predict,
  restrictionNotice,
  DESIRE_LABELS,
  TIP_CATEGORIES,
  TIP_CATEGORY_LABELS,
  groupTips,
  isEmptyLog,
  summariseIntimacy,
  visibleTips,
} from './logic'
export type {
  ConsentScope,
  CycleLog,
  DayMark,
  HealthRecord,
  IntimacyLog,
  IntimacySummary,
  PredictedCycle,
  Prediction,
  TipAudience,
  TipCategory,
  WellnessTip,
} from './types'
