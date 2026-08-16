/**
 * What the service worker serves when a navigation cannot reach the network.
 *
 * Outside the `(app)` group on purpose: that layout gates on a session, and a
 * session check is exactly what cannot happen offline. This page must render
 * from cache with no data and no auth.
 *
 * It does not pretend. The plan is not cached — see the note at the top of
 * `public/sw.js` for why not — so this says the connection is gone rather than
 * showing a stale itinerary somebody might act on.
 */
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Offline — Meridian',
}

export default function Offline() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-lg font-medium">No connection</h1>
      <p className="text-sm text-muted-foreground">
        Meridian needs the network to show your plans. They are safe — they are just not on this
        device.
      </p>
      <p className="text-sm text-muted-foreground">
        This page will work again the moment you are back online.
      </p>
      {/* A plain anchor, not a router push: there is no router here, and a full
          reload is what actually retries the navigation. */}
      <a
        className="mt-2 inline-flex h-10 items-center rounded-md border border-input px-4 text-sm hover:bg-secondary"
        href="/"
      >
        Try again
      </a>
    </main>
  )
}
