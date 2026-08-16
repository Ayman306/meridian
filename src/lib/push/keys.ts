/**
 * VAPID key handling, and the base64url conversion browsers insist on.
 *
 * The public key is genuinely public — it is handed to every browser that
 * subscribes, and it is what the push service uses to verify that a message
 * claiming to be from us really is. `NEXT_PUBLIC_` is correct for it, and is
 * not an exception to non-negotiable #2: the private key, which is the one that
 * signs, never leaves the server.
 */

/**
 * `PushManager.subscribe` takes the application server key as raw bytes, not as
 * the base64url string everything else in the ecosystem uses. Converting is
 * left to each application, which is why every push tutorial contains a copy of
 * this function.
 */
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  // Restore the padding base64url drops, then undo the URL-safe alphabet.
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const normalised = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')

  const raw = atob(normalised)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i)
  return output
}

/** The public key, or null when push has not been configured for this deploy. */
export function publicVapidKey(): string | null {
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  return key && key.length > 0 ? key : null
}

/**
 * The categories a notification can belong to.
 *
 * Each maps to a `notify_*` column on `user_settings`, which the Settings
 * screen has exposed since phase 13 — this is what finally reads them.
 */
export const PUSH_CATEGORIES = [
  'flights',
  'documents',
  'allowance',
  'daily_exchange',
  'partner_activity',
] as const

export type PushCategory = (typeof PUSH_CATEGORIES)[number]

/**
 * The `user_settings` column that governs a category.
 *
 * A literal map rather than a template string, so the return type is the union
 * of real column names and a typo is a compile error instead of a silent
 * lookup that comes back undefined — which would read as "not opted out".
 */
const SETTING_COLUMNS = {
  flights: 'notify_flights',
  documents: 'notify_documents',
  allowance: 'notify_allowance',
  daily_exchange: 'notify_daily_exchange',
  partner_activity: 'notify_partner_activity',
} as const satisfies Record<PushCategory, string>

export type NotifyColumn = (typeof SETTING_COLUMNS)[PushCategory]

export function settingColumnFor(category: PushCategory): NotifyColumn {
  return SETTING_COLUMNS[category]
}
