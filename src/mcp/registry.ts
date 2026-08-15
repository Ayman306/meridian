/**
 * Every tool this server can offer, and the rule for which ones a given token
 * actually gets.
 *
 * Transport-agnostic by construction: nothing here imports the MCP SDK. The
 * stdio entry point wraps this, and when the remote connector arrives it will
 * wrap the same array. That is the whole reason the registry is separate from
 * the server.
 *
 * ## What is deliberately absent
 *
 * **Health.** There is no health tool and there is not going to be one by
 * accident — `FORBIDDEN_MODULES` refuses the module outright and a test asserts
 * no registered tool claims it. Cycle logs and medications are owner-private,
 * enforced in the database by consent rows that a partner has to be granted
 * explicitly (0014). Handing that to an assistant would route someone's medical
 * history through a model on the strength of a config file, and no plausible
 * travel question is worth it.
 *
 * **Documents.** Passport and visa numbers, behind signed URLs that expire in
 * five minutes. Same reasoning: an assistant that can read the vault is an
 * assistant that can be talked into reading it aloud.
 *
 * Both are `SENSITIVE_MODULES` in the settings module, which is where the
 * app-wide judgement about them already lives. Allowance is sensitive too, but
 * it is somebody's immigration history rather than a secret, so it is merely
 * off by default rather than refused — a token can be scoped to it on purpose.
 */
import type { ModuleName } from '@/modules/settings/types'
import { ALL_MODULES } from '@/modules/settings/logic'
import type { AnyTool } from './tools/types'
import { tripTools } from './tools/trips'
import { itineraryTools } from './tools/itinerary'
import { wishlistTools } from './tools/wishlist'
import { budgetTools } from './tools/budget'
import { flightTools } from './tools/flights'

/**
 * Modules no token may ever be scoped to, however the caller asks.
 *
 * Enforced here rather than only in the UI that mints tokens, because the UI is
 * one caller and this is the gate everything passes through.
 */
export const FORBIDDEN_MODULES: ModuleName[] = ['health', 'documents']

/** What a new token gets when nobody narrows it: everything not forbidden. */
export const DEFAULT_TOKEN_MODULES: ModuleName[] = ALL_MODULES.filter(
  (m) => !FORBIDDEN_MODULES.includes(m),
)

export const ALL_TOOLS: AnyTool[] = [
  ...tripTools,
  ...itineraryTools,
  ...wishlistTools,
  ...budgetTools,
  ...flightTools,
]

/** Modules that can be granted and would actually produce tools. */
export const GRANTABLE_MODULES: ModuleName[] = ALL_MODULES.filter(
  (m) => !FORBIDDEN_MODULES.includes(m) && ALL_TOOLS.some((tool) => tool.module === m),
)

/**
 * The tools a token may use.
 *
 * A forbidden module in the granted list is dropped rather than raising: tokens
 * outlive the code, and if a later migration ever wrote `health` into a row,
 * the correct behaviour is to quietly not offer health tools — not to break
 * every call the token makes.
 */
export function toolsFor(granted: readonly string[]): AnyTool[] {
  const allowed = new Set(
    granted.filter(
      (m): m is ModuleName =>
        (ALL_MODULES as string[]).includes(m) && !(FORBIDDEN_MODULES as string[]).includes(m),
    ),
  )
  return ALL_TOOLS.filter((tool) => allowed.has(tool.module))
}
