/** Public surface of the health module. Other modules import only from here. */
export { HealthPage } from './pages/HealthPage'
export { MedicationsPanel } from './components/MedicationsPanel'
export {
  useConsents,
  useHealthRecords,
  usePrediction,
  useRestrictions,
} from './hooks'
export {
  HEALTH_DISCLAIMER,
  NOT_CHECKED,
  checkSupply,
  describePrediction,
  describeSupply,
  hasConsent,
  matchRestrictions,
  predict,
  restrictionNotice,
} from './logic'
export type { ConsentScope, CycleLog, HealthRecord, Prediction } from './types'
