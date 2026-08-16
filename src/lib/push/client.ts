/**
 * Subscribing this browser to push, and telling the server about it.
 *
 * Push is the one part of a PWA that genuinely is not available everywhere, and
 * the failure modes are worth naming rather than papering over:
 *
 *   - **iOS** supports Web Push only from **16.4**, and only once the app has
 *     been added to the home screen. In a Safari tab there is no `PushManager`
 *     at all, which is why the install banner and this share a screen.
 *   - **Firefox in a private window** has no push.
 *   - Permission, once denied, cannot be asked for again from script. The
 *     browser has to be reset by the user, so a denial is reported as a state
 *     rather than retried.
 */
'use client'

import { urlBase64ToUint8Array, publicVapidKey } from './keys'

export type PushAvailability =
  | 'ready'
  /** No PushManager. Old browser, private window, or iOS in a browser tab. */
  | 'unsupported'
  /** Supported, but the deployment has no VAPID keys configured. */
  | 'not-configured'
  /** The user said no. Only they can undo this, in browser settings. */
  | 'denied'

export function pushAvailability(): PushAvailability {
  if (typeof window === 'undefined') return 'unsupported'
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported'
  if (!('Notification' in window)) return 'unsupported'
  if (!publicVapidKey()) return 'not-configured'
  if (Notification.permission === 'denied') return 'denied'
  return 'ready'
}

/** The shape the server stores. Matches `push_subscriptions`. */
export interface StoredSubscription {
  endpoint: string
  keys: { p256dh: string; auth: string }
  userAgent: string
}

/**
 * Ask for permission and subscribe.
 *
 * Returns null when the user declines, so the caller can leave the toggle off
 * without treating a considered "no" as a failure.
 */
export async function subscribeToPush(): Promise<StoredSubscription | null> {
  const key = publicVapidKey()
  if (!key) throw new Error('Push is not configured for this deployment.')

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return null

  const registration = await navigator.serviceWorker.ready

  // Reuse an existing subscription rather than creating a second one for the
  // same browser — `subscribe` with different options would throw, and the
  // endpoint is what the server keys on.
  const existing = await registration.pushManager.getSubscription()
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      // Chrome refuses a subscription that is not userVisibleOnly, and it is
      // the honest setting anyway: every push this app sends is a notification
      // somebody sees.
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
    }))

  return toStored(subscription)
}

/** Tear down this browser's subscription. Returns the endpoint that was removed. */
export async function unsubscribeFromPush(): Promise<string | null> {
  if (!('serviceWorker' in navigator)) return null
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  if (!subscription) return null

  const { endpoint } = subscription
  await subscription.unsubscribe()
  return endpoint
}

/** The current subscription, if this browser already has one. */
export async function currentSubscription(): Promise<StoredSubscription | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  return subscription ? toStored(subscription) : null
}

function toStored(subscription: PushSubscription): StoredSubscription {
  // `toJSON()` rather than reading `getKey()` by hand: it already base64url
  // encodes both keys, which is exactly what the server needs to send with.
  const json = subscription.toJSON() as {
    endpoint?: string
    keys?: { p256dh?: string; auth?: string }
  }

  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
    throw new Error('The browser returned an incomplete push subscription.')
  }

  return {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    // So somebody can tell "my old phone" from "this laptop" in a device list.
    userAgent: navigator.userAgent,
  }
}
