import { describe, expect, it } from 'vitest'
import { installOffer, isIos, isIosSafari, isStandalone } from '@/lib/pwa/install'

const UA = {
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1',
  iphoneFirefox:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15',
  ipadOs:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36',
  desktopFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0',
}

describe('detecting iOS', () => {
  it('recognises the obvious ones', () => {
    expect(isIos(UA.iphoneSafari)).toBe(true)
    expect(isIos(UA.androidChrome)).toBe(false)
    expect(isIos(UA.desktopFirefox)).toBe(false)
  })

  it('recognises an iPad pretending to be a Mac', () => {
    // Since iPadOS 13 the UA is indistinguishable from desktop Safari. Without
    // the touch-point check every iPad is told it cannot install.
    expect(isIos(UA.ipadOs, 5)).toBe(true)
    expect(isIos(UA.macSafari, 0)).toBe(false)
  })
})

describe('detecting Safari on iOS', () => {
  it('accepts Safari', () => {
    expect(isIosSafari(UA.iphoneSafari)).toBe(true)
    expect(isIosSafari(UA.ipadOs, 5)).toBe(true)
  })

  it('rejects the WebKit wrappers', () => {
    // They are WebKit underneath, but their share sheets have no "Add to Home
    // Screen", so the instructions would send someone hunting for nothing.
    expect(isIosSafari(UA.iphoneChrome)).toBe(false)
    expect(isIosSafari(UA.iphoneFirefox)).toBe(false)
  })

  it('rejects everything not on iOS', () => {
    expect(isIosSafari(UA.macSafari, 0)).toBe(false)
    expect(isIosSafari(UA.androidChrome)).toBe(false)
  })
})

describe('detecting an installed app', () => {
  const media = (matching: string[]) => (query: string) => ({
    matches: matching.some((mode) => query.includes(mode)),
  })

  it('trusts the iOS flag', () => {
    expect(isStandalone(undefined, true)).toBe(true)
  })

  it('reads the standard display-mode', () => {
    expect(isStandalone(media(['standalone']), undefined)).toBe(true)
  })

  it('counts the other installed display modes', () => {
    // A manifest change from standalone to fullscreen must not resurrect the
    // banner for somebody who already installed.
    expect(isStandalone(media(['fullscreen']), undefined)).toBe(true)
    expect(isStandalone(media(['minimal-ui']), undefined)).toBe(true)
  })

  it('knows a browser tab when it sees one', () => {
    expect(isStandalone(media([]), undefined)).toBe(false)
    expect(isStandalone(media([]), false)).toBe(false)
    expect(isStandalone(undefined, undefined)).toBe(false)
  })
})

describe('whether to offer an install', () => {
  const base = {
    installed: false,
    dismissed: false,
    hasPromptEvent: false,
    supportsManualInstall: false,
  }

  it('offers a real button when the browser gives us one', () => {
    expect(installOffer({ ...base, hasPromptEvent: true })).toBe('prompt')
  })

  it('falls back to instructions on iOS, which has no event', () => {
    expect(installOffer({ ...base, supportsManualInstall: true })).toBe('manual')
  })

  it('says nothing where installing is not possible', () => {
    // Desktop Firefox. Showing "add to home screen" there would be a lie.
    expect(installOffer(base)).toBe('hidden')
  })

  it('never asks somebody who already installed', () => {
    expect(installOffer({ ...base, installed: true, hasPromptEvent: true })).toBe('hidden')
    expect(installOffer({ ...base, installed: true, supportsManualInstall: true })).toBe('hidden')
  })

  it('never asks twice', () => {
    expect(installOffer({ ...base, dismissed: true, hasPromptEvent: true })).toBe('hidden')
    expect(installOffer({ ...base, dismissed: true, supportsManualInstall: true })).toBe('hidden')
  })

  it('prefers the installed check over the dismissal check', () => {
    // The two flags can disagree — installed via the browser's own menu, never
    // having touched our banner. Installed wins either way.
    expect(installOffer({ ...base, installed: true, dismissed: false, hasPromptEvent: true })).toBe(
      'hidden',
    )
  })
})
