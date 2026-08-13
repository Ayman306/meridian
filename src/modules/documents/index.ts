/** Public surface of the documents module. */
export { VaultPage } from './pages/VaultPage'
export { DocumentViewerPage } from './pages/DocumentViewerPage'
export { TripReadiness } from './components/TripReadiness'
export { ExpiryBadge } from './components/ExpiryBadge'
export {
  useDocument,
  useDocuments,
  useDocumentTypes,
  useSignedUrl,
  useTripReadiness,
  useUploadDocument,
  useUpdateDocument,
  useDeleteDocument,
  useAddRequirement,
  useRemoveRequirement,
} from './hooks'
export {
  ALERT_THRESHOLDS,
  buildReadiness,
  byUrgency,
  crossedThreshold,
  expiryStatus,
  expiryStatusToday,
  formatBytes,
  isActionable,
  isReady,
  lastFour,
  maskNumber,
  readinessFraction,
  sanitiseFileName,
  shouldAlert,
  storagePath,
  PASSPORT_BLOCKING_MONTHS,
  PASSPORT_WARNING_MONTHS,
} from './logic'
export type { AlertThreshold } from './logic'
export type {
  DocumentType,
  DocumentWithType,
  ExpiryLevel,
  ExpiryStatus,
  ReadinessReport,
  RequirementRow,
  TravelDocument,
} from './types'
