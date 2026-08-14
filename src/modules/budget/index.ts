/** Public surface of the budget module. Other modules import only from here. */
export { TripMoneyPage } from './pages/TripMoneyPage'
export { MoneyPage } from './pages/MoneyPage'
export { RateCalculator } from './components/RateCalculator'
export { CurrencyPicker } from './components/CurrencyPicker'
export {
  useBalance,
  useBaseCurrency,
  useDestinationCurrency,
  useExpenses,
  useSetBaseCurrency,
  useTripSummary,
} from './hooks'
export {
  balance,
  budgetProgress,
  describeBalance,
  formatMoney,
  round2,
  shares,
  summarise,
  toBase,
  toCsv,
  validateSplit,
} from './logic'
export type { Balance, BalanceLine, Expense, Settlement, Summary } from './types'
