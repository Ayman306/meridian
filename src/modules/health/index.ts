/** Public surface of the health module. Other modules import only from here. */
export { HealthPage } from './pages/HealthPage'
export { MedicationsPanel } from './components/MedicationsPanel'
export { CycleCalendar } from './components/CycleCalendar'
export {
  useConsents,
  useHealthRecords,
  usePrediction,
  useRestrictions,
} from './hooks'
export {
  FERTILITY_DISCLAIMER,
  HEALTH_DISCLAIMER,
  NOT_CHECKED,
  calendarMarks,
  describeProjectedCycle,
  monthGrid,
  monthOf,
  predictCycles,
  shiftMonth,
  checkSupply,
  describePrediction,
  describeSupply,
  hasConsent,
  matchRestrictions,
  predict,
  restrictionNotice,
} from './logic'
export type {
  ConsentScope,
  CycleLog,
  DayMark,
  HealthRecord,
  PredictedCycle,
  Prediction,
} from './types'
