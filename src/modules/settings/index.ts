/** Public surface of the settings module. Other modules import only from here. */
export { SettingsPage } from './pages/SettingsPage'
export { AccessPanel } from './components/AccessPanel'
export { AssistantsPanel } from './components/AssistantsPanel'
export { ConsentScreen } from './components/ConsentScreen'
export { PushPanel } from './components/PushPanel'
export {
  useGrants,
  useAcceptInvite,
  useCoupleSettings,
  useDistanceUnit,
  useSaveGrant,
  useRevokeGrant,
  useCreateInvite,
  useInvites,
  useMyAccess,
  useUpdateCoupleSettings,
  useUpdateUserSettings,
  useUserSettings,
} from './hooks'
export {
  ALL_MODULES,
  DEFAULT_GUEST_MODULES,
  INVITE_ERRORS,
  MODULE_LABELS,
  ROLE_LABELS,
  SENSITIVE_MODULES,
  canGrant,
  canSee,
  describeAccess,
  isOwning,
  isSensitive,
  normaliseGrants,
  visibleModules,
} from './logic'
export type {
  McpGrant,
  MemberRole,
  ModuleName,
  Member,
  CoupleSettings,
  UserSettings,
} from './types'
