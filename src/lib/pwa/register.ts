/**
 * Service worker registration, and the small amount of state a page needs to
 * know about it.
 *
 * Registration is deliberately late — after `load` — because a worker
 * installing during startup competes for bandwidth with the very assets the
 * first paint is waiting on. On a hotel wifi connection that trade is worth
 * making: the worker helps the *second* visit, never the first.
 */
'use client'

/** Where the worker lives. Root scope, so it controls every route. */
const SW_URL = '/sw.js'

export function serviceWorkerSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator
}

/**
 * Register, once the page has settled.
 *
 * Returns the registration, or null when workers are unavailable — Firefox in
 * a private window, an insecure origin, or a browser old enough not to care
 * about. Every caller treats null as "no offline support", never as an error:
 * the app works identically without a worker, it is just slower on repeat
 * visits.
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!serviceWorkerSupported()) return null

  try {
    const registration = await navigator.serviceWorker.register(SW_URL, { scope: '/' })

    // Check for a new deployment when the tab regains focus. Browsers do this
    // on their own roughly daily, which is too slow for an app that ships
    // several times a week.
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void registration.update()
      })
    }

    return registration
  } catch (error) {
    // A failed registration is not worth interrupting anybody over.
    console.warn('service worker registration failed', error)
    return null
  }
}

/**
 * Drop everything this origin has cached.
 *
 * Called on sign-out. Nothing user-specific is cached — see the note at the top
 * of `public/sw.js` — so this is defence in depth rather than the thing the
 * privacy argument rests on.
 */
export async function clearServiceWorkerCaches(): Promise<void> {
  if (!serviceWorkerSupported()) return
  const registration = await navigator.serviceWorker.getRegistration()
  registration?.active?.postMessage({ type: 'CLEAR_CACHES' })
}
