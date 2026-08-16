/**
 * Turning push notifications on for this browser.
 *
 * Per browser, not per account, which is the part people find surprising: a
 * subscription belongs to one installed browser on one device, so turning it on
 * here does nothing for your phone. The copy says so rather than leaving
 * somebody to wonder why their laptop is silent.
 *
 * Every state this can be in is rendered, because on iOS the interesting one is
 * "not yet" rather than "no": Safari has had Web Push since 16.4 but only for
 * an app that has been added to the home screen, so a tab genuinely cannot do
 * this and telling the user to install first is the actionable answer.
 */
'use client'

import { Bell, BellOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/common/states'
import { useDisablePush, useEnablePush, usePushState } from '../hooks'

export function PushPanel() {
  const state = usePushState()
  const enable = useEnablePush()
  const disable = useDisablePush()

  if (state.isLoading) return null

  const availability = state.data?.availability ?? 'unsupported'
  const subscribed = Boolean(state.data?.subscription)
  const devices = state.data?.devices ?? 0

  if (availability === 'unsupported') {
    return (
      <p className="text-xs text-muted-foreground">
        This browser cannot receive push notifications. On an iPhone or iPad, add Meridian to your
        home screen first — Safari only allows them for an installed app.
      </p>
    )
  }

  if (availability === 'not-configured') {
    return (
      <p className="text-xs text-muted-foreground">
        Push is not set up on this deployment yet, so the choices above are recorded but nothing is
        sent.
      </p>
    )
  }

  if (availability === 'denied') {
    return (
      <p className="text-xs text-muted-foreground">
        Notifications are blocked for this site. Only you can undo that, in your browser&rsquo;s site
        settings — a page cannot ask again once it has been refused.
      </p>
    )
  }

  return (
    <div className="space-y-2 border-t border-border pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm">{subscribed ? 'This browser is set up' : 'This browser is not set up'}</p>
          <p className="text-xs text-muted-foreground">
            {devices === 0
              ? 'No devices registered yet.'
              : `${devices} device${devices === 1 ? '' : 's'} registered on your account.`}
          </p>
        </div>

        {subscribed ? (
          <Button
            variant="outline"
            size="sm"
            disabled={disable.isPending}
            onClick={() => disable.mutate()}
          >
            <BellOff aria-hidden="true" />
            {disable.isPending ? 'Turning off…' : 'Turn off here'}
          </Button>
        ) : (
          <Button size="sm" disabled={enable.isPending} onClick={() => enable.mutate()}>
            <Bell aria-hidden="true" />
            {enable.isPending ? 'Asking…' : 'Turn on here'}
          </Button>
        )}
      </div>

      {/* A declined browser prompt resolves successfully with `false`. It is
          an answer, not a failure, so it is reported as one. */}
      {enable.data === false && (
        <p className="text-xs text-muted-foreground">
          Your browser did not grant permission, so nothing was turned on.
        </p>
      )}
      {enable.error ? <ErrorState error={enable.error} title="That did not work" /> : null}
      {disable.error ? <ErrorState error={disable.error} title="That did not work" /> : null}

      <p className="text-xs text-muted-foreground">
        Notifications are set up for each browser separately, so your phone and your laptop are
        turned on one at a time.
      </p>
    </div>
  )
}
