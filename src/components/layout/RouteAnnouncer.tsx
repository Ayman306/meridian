/**
 * What a screen reader hears when the page changes.
 *
 * A client-side route change is invisible to assistive technology. The browser
 * does not reload, so nothing is announced, and — worse — focus stays on the
 * link that was clicked. That link usually no longer exists in the new page, so
 * focus silently falls back to `<body>` and the user's keyboard position is
 * gone. They tab from the very top again, through all eleven navigation items,
 * every single time.
 *
 * Two things fix it, and both are needed:
 *
 *   1. **Move focus to `<main>`.** That resets the tab order to the content
 *      rather than the chrome, and is what makes "skip to content" and ordinary
 *      navigation agree with each other.
 *   2. **Announce the page.** Focusing a container is not reliably spoken
 *      across screen readers, so the name is also written into a polite live
 *      region. Polite rather than assertive: a page change is not an
 *      interruption.
 *
 * Deliberately silent on first load. The browser already announces a full page
 * load, and stealing focus from the top of a page somebody has just arrived at
 * is the bug this component exists to prevent, not one to introduce.
 */
'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { MAIN_CONTENT_ID } from './ids'

/**
 * Path to a spoken name.
 *
 * Derived rather than looked up in a table: a table would have to list every
 * route including the dynamic ones, and would go stale the moment somebody adds
 * a screen. "Trip, plan" is a good enough description of `/trips/<uuid>/plan`,
 * and an id is never read aloud — hearing a UUID is worse than hearing nothing.
 */
export function describeRoute(pathname: string): string {
  const parts = pathname.split('/').filter(Boolean)
  if (parts.length === 0) return 'Home'

  const spoken = parts
    // A uuid or a long opaque token is noise read aloud.
    .filter((part) => !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(part) && part.length < 24)
    .map((part) => part.replace(/-/g, ' '))

  if (spoken.length === 0) return 'Page'
  const [first, ...rest] = spoken
  return [first!.charAt(0).toUpperCase() + first!.slice(1), ...rest].join(', ')
}

export function RouteAnnouncer() {
  const pathname = usePathname()
  const [message, setMessage] = useState('')
  const firstRender = useRef(true)

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }

    const main = document.getElementById(MAIN_CONTENT_ID)
    // `tabIndex={-1}` on the element makes this legal without putting <main>
    // into the tab order for everybody else.
    main?.focus({ preventScroll: true })
    // Scrolled separately, because preventScroll above stops the browser
    // jumping to wherever <main> happens to be — but a new page should still
    // start at the top.
    window.scrollTo({ top: 0 })

    setMessage(describeRoute(pathname))
  }, [pathname])

  return (
    <p aria-live="polite" aria-atomic="true" className="sr-only">
      {message}
    </p>
  )
}
