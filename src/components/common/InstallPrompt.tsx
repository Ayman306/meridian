/**
 * The "add Meridian to your home screen" banner.
 *
 * Shown once. Declining, or installing, means never seeing it again — the
 * decision is remembered in localStorage and, more reliably, inferred from the
 * app running standalone at all.
 *
 * Three ways this renders, decided by `installOffer`: a real button where the
 * browser gives us one, share-sheet instructions on iOS where it does not, and
 * nothing at all everywhere else. See `lib/pwa/install.ts` for why that is
 * three cases rather than a boolean.
 */
'use client'

import { useCallback, useEffect, useState } from 'react'
import { Download, Share, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  INSTALL_DISMISSED_KEY,
  installOffer,
  isIosSafari,
  isStandalone,
  type InstallOffer,
} from '@/lib/pwa/install'

/**
 * Chromium's install event. Not in lib.dom, because it is not standardised —
 * which is the same reason the iOS branch below exists.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function InstallPrompt() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [offer, setOffer] = useState<InstallOffer>('hidden')
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const installed = isStandalone(
      window.matchMedia.bind(window),
      (navigator as Navigator & { standalone?: boolean }).standalone,
    )
    const alreadySaidNo = localStorage.getItem(INSTALL_DISMISSED_KEY) === 'true'
    const manual = isIosSafari(navigator.userAgent, navigator.maxTouchPoints)

    const decide = (event: BeforeInstallPromptEvent | null) =>
      setOffer(
        installOffer({
          installed,
          dismissed: alreadySaidNo || dismissed,
          hasPromptEvent: event !== null,
          supportsManualInstall: manual,
        }),
      )

    decide(promptEvent)

    const onBeforeInstall = (event: Event) => {
      // Without this Chromium shows its own mini-infobar, and the app has no
      // say in when the ask happens.
      event.preventDefault()
      const typed = event as BeforeInstallPromptEvent
      setPromptEvent(typed)
      decide(typed)
    }

    // Fires when the install completes by any route, including the browser's
    // own menu — which is the case a dismissal flag would miss entirely.
    const onInstalled = () => {
      setOffer('hidden')
      localStorage.setItem(INSTALL_DISMISSED_KEY, 'true')
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [dismissed, promptEvent])

  const dismiss = useCallback(() => {
    localStorage.setItem(INSTALL_DISMISSED_KEY, 'true')
    setDismissed(true)
    setOffer('hidden')
  }, [])

  const install = useCallback(async () => {
    if (!promptEvent) return
    await promptEvent.prompt()
    const { outcome } = await promptEvent.userChoice
    // Either way the banner goes. Accepting installs it; declining is an
    // answer, and asking twice is what makes these things hated.
    localStorage.setItem(INSTALL_DISMISSED_KEY, 'true')
    setPromptEvent(null)
    setOffer('hidden')
    if (outcome === 'accepted') setDismissed(true)
  }, [promptEvent])

  if (offer === 'hidden') return null

  return (
    <div
      role="region"
      aria-label="Install Meridian"
      /* Above the mobile tab bar, never on top of it — a banner at `bottom-0`
         would cover the app's navigation with a dialog about installing the
         app. `--bottom-nav-height` is 0 unless AppShell is mounted (see
         index.css), so on sign-in and the offline page, which have no tab bar,
         this sits on the floor rather than hovering over a phantom one. The
         home-indicator inset is added on top either way. */
      className="fixed inset-x-0 bottom-[calc(var(--bottom-nav-height)+env(safe-area-inset-bottom))] z-50 border-y border-border bg-card/95 p-4 backdrop-blur supports-[backdrop-filter]:bg-card/80"
    >
      <div className="mx-auto flex max-w-2xl items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium">Add Meridian to your home screen</p>
          {offer === 'prompt' ? (
            <p className="text-sm text-muted-foreground">
              Opens like an app, starts faster, and can send you flight alerts.
            </p>
          ) : (
            <p className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
              Tap
              <Share className="inline size-4 shrink-0" aria-hidden="true" />
              <span className="sr-only">Share</span>
              in Safari&rsquo;s toolbar, then
              <Plus className="inline size-4 shrink-0" aria-hidden="true" />
              <span>Add to Home Screen.</span>
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {offer === 'prompt' && (
            <Button size="sm" onClick={() => void install()}>
              <Download aria-hidden="true" />
              Install
            </Button>
          )}
          <Button variant="ghost" size="icon" aria-label="Not now" onClick={dismiss}>
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  )
}
