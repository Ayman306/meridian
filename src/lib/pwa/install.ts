/**
 * Whether to offer installation, and how.
 *
 * Pure. The browser detection and the decision live here so they can be tested
 * against real user-agent strings; the component does the listening and the
 * rendering and nothing else.
 *
 * The awkward fact this exists to handle: **there is no cross-browser way to
 * offer an install.** Chromium fires `beforeinstallprompt` and gives you a
 * `prompt()` you can call from a click. Safari fires nothing and has no API at
 * all — installing means the user finding Share → Add to Home Screen
 * themselves. Firefox on desktop does not install web apps. So the honest model
 * is three outcomes, not a boolean.
 */

/** What, if anything, to show. */
export type InstallOffer =
  /** Nothing — already installed, already declined, or not installable here. */
  | 'hidden'
  /** A real button. Chromium handed us an event we can fire on click. */
  | 'prompt'
  /** Instructions. iOS, where the user has to do it through the share sheet. */
  | 'manual'

export interface InstallState {
  /** Running as an installed app rather than in a browser tab. */
  installed: boolean
  /** They have said no once. We do not ask again. */
  dismissed: boolean
  /** A `beforeinstallprompt` event is in hand. */
  hasPromptEvent: boolean
  /** The platform can install, but only by hand. iOS. */
  supportsManualInstall: boolean
}

/**
 * The whole decision, in the order the conditions matter.
 *
 * `installed` is checked before `dismissed` deliberately: somebody who
 * installed the app after dismissing the banner should never see it again for
 * the more fundamental reason, and the two flags can disagree.
 */
export function installOffer(state: InstallState): InstallOffer {
  if (state.installed) return 'hidden'
  if (state.dismissed) return 'hidden'
  if (state.hasPromptEvent) return 'prompt'
  if (state.supportsManualInstall) return 'manual'
  return 'hidden'
}

/**
 * iOS, including iPadOS pretending to be a Mac.
 *
 * Since iPadOS 13 an iPad reports a desktop Safari UA, so the touch-point check
 * is not optional — without it every iPad falls through to "not installable"
 * and is never told how.
 */
export function isIos(userAgent: string, maxTouchPoints = 0): boolean {
  if (/iPad|iPhone|iPod/i.test(userAgent)) return true
  return /Macintosh/i.test(userAgent) && maxTouchPoints > 1
}

/**
 * Safari proper, not a WebKit wrapper.
 *
 * On iOS every browser is WebKit underneath, but only Safari's share sheet has
 * "Add to Home Screen" — Chrome and Firefox there show a different menu, so
 * telling their users to look for it would send them hunting for something
 * that is not on screen.
 */
export function isIosSafari(userAgent: string, maxTouchPoints = 0): boolean {
  if (!isIos(userAgent, maxTouchPoints)) return false
  // CriOS = Chrome, FxiOS = Firefox, EdgiOS = Edge, OPiOS/OPT = Opera.
  return !/CriOS|FxiOS|EdgiOS|OPiOS|OPT\//i.test(userAgent)
}

/**
 * Already running as an installed app?
 *
 * Two mechanisms because Safari implements neither the same way as anyone
 * else: `display-mode: standalone` is the standard, and `navigator.standalone`
 * is the non-standard iOS flag that predates it and is still what iOS sets.
 */
export function isStandalone(
  matchMedia: ((query: string) => { matches: boolean }) | undefined,
  navigatorStandalone: boolean | undefined,
): boolean {
  if (navigatorStandalone === true) return true
  if (!matchMedia) return false
  // `minimal-ui` and `fullscreen` are also "not a browser tab" — a manifest
  // change should not resurrect the banner for people who already installed.
  return ['standalone', 'minimal-ui', 'fullscreen'].some(
    (mode) => matchMedia(`(display-mode: ${mode})`).matches,
  )
}

/** Where the dismissal is remembered. */
export const INSTALL_DISMISSED_KEY = 'meridian:install-dismissed'
