/**
 * Every tool this server can offer, and the rule for which ones a given token
 * actually gets.
 *
 * Transport-agnostic by construction: nothing here imports the MCP SDK. The
 * stdio entry point wraps this, and when the remote connector arrives it will
 * wrap the same array. That is the whole reason the registry is separate from
 * the server.
 *
 * ## Sensitive modules are opt-in, not off-limits
 *
 * Health and documents were refused outright in the first version of this
 * server. They are now reachable, but only by a token whose owner ticked them
 * deliberately, and never by default.
 *
 * The reasoning for the change: a personal access token *is* its owner. RLS
 * restricts every health read to `owner_id = auth.uid()`, and the health tools
 * narrow it again in the query itself, so the only person whose cycle logs a
 * token can reach is the person who created the token. Refusing that outright
 * was not protecting a partner — it was overriding the owner's own choice about
 * their own data.
 *
 * What genuinely changes when these are granted is that the data reaches an AI
 * provider. That is a real decision with real consequences, so it is made
 * explicitly, in Settings, next to a sentence that says so — rather than being
 * quietly included in a default that nobody reads.
 *
 * Two properties still hold regardless of scope, and are asserted in the
 * tests: a token can never reach the *other* person's health data, and
 * documents expose metadata only — never a storage path, never a signed URL,
 * never a document number.
 */
import type { ModuleName } from '@/modules/settings/types'
import { ALL_MODULES } from '@/modules/settings/logic'
import type { AnyTool } from './tools/types'
import { tripTools } from './tools/trips'
import { itineraryTools } from './tools/itinerary'
import { wishlistTools } from './tools/wishlist'
import { budgetTools } from './tools/budget'
import { flightTools } from './tools/flights'
import { destinationTools } from './tools/destinations'
import { allowanceTools } from './tools/allowance'
import { healthTools } from './tools/health'
import { documentTools } from './tools/documents'
import { galleryTools } from './tools/gallery'
import { trayTools } from './tools/tray'
import { dashboardTools } from './tools/dashboard'

/**
 * Modules a token may reach only when its owner ticked them on purpose.
 *
 * Kept out of the default scope rather than out of the system. Granting one
 * means that module's data can travel to whatever model the token is plugged
 * into, which is the owner's call to make and nobody else's — but it should
 * never happen because somebody accepted a default.
 */
export const SENSITIVE_TOKEN_MODULES: ModuleName[] = ['health', 'documents']

/** What a new token gets when nobody narrows it: everything but the sensitive. */
export const DEFAULT_TOKEN_MODULES: ModuleName[] = ALL_MODULES.filter(
  (m) => !SENSITIVE_TOKEN_MODULES.includes(m),
)

export const ALL_TOOLS: AnyTool[] = [
  ...tripTools,
  ...itineraryTools,
  ...wishlistTools,
  ...budgetTools,
  ...flightTools,
  ...destinationTools,
  ...allowanceTools,
  ...galleryTools,
  ...trayTools,
  ...dashboardTools,
  // Sensitive. Present in the registry, but never in a default scope — see
  // SENSITIVE_TOKEN_MODULES above.
  ...healthTools,
  ...documentTools,
]

/** Every module that would actually produce tools, sensitive ones included. */
export const GRANTABLE_MODULES: ModuleName[] = ALL_MODULES.filter((m) =>
  ALL_TOOLS.some((tool) => tool.module === m),
)

/**
 * The tools a token may use.
 *
 * An unrecognised module in the granted list is dropped rather than raising:
 * tokens outlive the code, and a row naming a module a later version removed
 * should quietly offer nothing for it rather than break every call the token
 * makes.
 */
export function toolsFor(granted: readonly string[]): AnyTool[] {
  const allowed = new Set(
    granted.filter((m): m is ModuleName => (ALL_MODULES as string[]).includes(m)),
  )
  return ALL_TOOLS.filter((tool) => allowed.has(tool.module))
}
