/** Public surface of the settings module. Other modules import only from here. */
export { SettingsPage } from './pages/SettingsPage'
export { AccessPanel } from './components/AccessPanel'
export {
  useAcceptInvite,
  useCoupleSettings,
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
export type { MemberRole, ModuleName, Member, CoupleSettings, UserSettings } from './types'
