/**
 * The web app manifest. Next generates `/manifest.webmanifest` from this.
 *
 * `display: 'standalone'` rather than `fullscreen`: this app is used one-handed
 * while somebody is actually travelling, and taking the status bar away hides
 * the clock and the battery from a person who is probably checking both.
 *
 * The shortcuts are the three things worth reaching without navigating — the
 * plan, what is booked, and what was spent. Android surfaces them on a long
 * press of the icon; everything else ignores the field harmlessly.
 */
import type { MetadataRoute } from 'next'
import { APP_NAME } from '@/lib/constants'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${APP_NAME} — travel for two`,
    short_name: APP_NAME,
    description: 'Travel planning for long-distance couples. Two passports, two time zones, one shared trip.',
    start_url: '/',
    // Anything outside this leaves the installed window and opens a browser.
    // '/' rather than a narrower path because the whole app is in scope.
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#0b0d12',
    theme_color: '#0b0d12',
    categories: ['travel', 'lifestyle', 'productivity'],
    icons: [
      // `any` and `maskable` are separate entries on purpose. Declaring one
      // icon as both makes every masking platform crop a mark that was drawn
      // to fill the square. See scripts/build-icons.mjs.
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Trips', url: '/trips' },
      { name: 'Flights', url: '/flights' },
      { name: 'Money', url: '/money' },
    ],
  }
}
