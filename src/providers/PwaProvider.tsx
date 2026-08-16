/**
 * Registers the service worker and hangs the install banner off the tree.
 *
 * A provider rather than a hook call in the layout because it renders
 * something, and because registration should happen exactly once for the
 * application rather than once per route that remembers to ask.
 */
'use client'

import { useEffect, type ReactNode } from 'react'
import { registerServiceWorker } from '@/lib/pwa/register'
import { InstallPrompt } from '@/components/common/InstallPrompt'

export function PwaProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    // After `load`, not during it. A worker installing while the first paint
    // is still fetching competes with it for a connection that, on this app's
    // worst day, is hotel wifi. The worker only helps the second visit anyway.
    if (document.readyState === 'complete') {
      void registerServiceWorker()
      return
    }
    const onLoad = () => void registerServiceWorker()
    window.addEventListener('load', onLoad, { once: true })
    return () => window.removeEventListener('load', onLoad)
  }, [])

  return (
    <>
      {children}
      <InstallPrompt />
    </>
  )
}
