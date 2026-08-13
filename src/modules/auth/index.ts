/** Public surface of the auth module. Other modules import only from here. */
export { LoginPage } from './pages/LoginPage'
export { PairPage } from './pages/PairPage'
export { SetupPage } from './pages/SetupPage'
export {
  useCreateCouple,
  useJoinCouple,
  useLeaveCouple,
  useRegenerateInviteCode,
  useUpdateCouple,
  useUpdateProfile,
} from './hooks'
export {
  describeInviteExpiry,
  isInviteExpired,
  needsProfileSetup,
  normaliseInviteCode,
  toPersonRef,
} from './logic'
export type { ProfileSetupInput } from './schemas'
