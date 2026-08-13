/** Public surface of the dashboard module. */
export { DashboardPage } from './pages/DashboardPage'
export { useDashboard, useToday } from './hooks'
export {
  buildAlerts,
  countdown,
  isDaylight,
  nightsTogether,
  sortAlerts,
  togetherWindow,
  VISIBLE_ALERTS,
} from './logic'
export type {
  Alert,
  AlertKind,
  Countdown,
  CountdownState,
  DashboardPayload,
  NightsTogether,
} from './types'
