'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  CalendarRange,
  FileText,
  Heart,
  Home,
  Images,
  Map as MapIcon,
  Plane,
  Settings as SettingsIcon,
  HeartPulse,
  Timer,
  Wallet,
} from 'lucide-react'
import { useCouple } from '@/providers/CoupleProvider'
import { useAccess } from '@/providers/AccessProvider'
import { DualTime } from '@/components/DualTime'
import { PersonBadge } from '@/components/PersonBadge'
import { APP_NAME } from '@/lib/constants'
import { cn } from '@/lib/utils'
import { MAIN_CONTENT_ID } from './ids'
import { RouteAnnouncer } from './RouteAnnouncer'

/**
 * `short` is what the bottom bar uses.
 *
 * At nine entries a 360px screen gave each one forty pixels — an icon and four
 * characters, and no more. The tenth would have taken that to thirty-six,
 * which is below what stays legible, so the bar scrolls instead of shrinking
 * and each item keeps a fixed width. The active one is scrolled into view on
 * navigation, since a nav bar that hides items off-screen with no hint is
 * worse than a cramped one.
 */
const NAV = [
  { href: '/', label: 'Home', short: 'Home', icon: Home, exact: true, module: null },
  { href: '/trips', label: 'Trips', short: 'Trips', icon: CalendarRange, exact: false, module: 'trips' },
  { href: '/wishlist', label: 'Wishlist', short: 'Saves', icon: Heart, exact: false, module: 'wishlist' },
  { href: '/map', label: 'Map', short: 'Map', icon: MapIcon, exact: false, module: 'trips' },
  { href: '/flights', label: 'Flights', short: 'Fly', icon: Plane, exact: false, module: 'flights' },
  { href: '/gallery', label: 'Photos', short: 'Pics', icon: Images, exact: false, module: 'photos' },
  { href: '/documents', label: 'Docs', short: 'Docs', icon: FileText, exact: false, module: 'documents' },
  { href: '/allowance', label: 'Allowance', short: 'Stay', icon: Timer, exact: false, module: 'allowance' },
  { href: '/money', label: 'Money', short: 'Cash', icon: Wallet, exact: false, module: 'money' },
  { href: '/health', label: 'Health', short: 'You+', icon: HeartPulse, exact: false, module: 'health' },
  { href: '/settings', label: 'Settings', short: 'You', icon: SettingsIcon, exact: false, module: null },
] as const

export function AppShell({ children }: { children: React.ReactNode }) {
  const { selfRef, partnerRef, tzSelf, tzPartner } = useCouple()
  const { can } = useAccess()
  const pathname = usePathname()
  const activeRef = useRef<HTMLAnchorElement>(null)

  // Hiding a link is a courtesy, not the control. The same membership row that
  // drives this drives every RLS policy, so a link that is missing here would
  // have led to a screen with no rows in it anyway.
  const nav = NAV.filter((item) => item.module === null || can(item.module))

  const isActive = (href: string, exact: boolean) =>
    exact ? pathname === href : pathname.startsWith(href)

  // Keep the current section visible in the scrolling bar. Reading the ref in
  // an effect rather than during render is what the compiler requires, and it
  // is also the only point at which the DOM node exists.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [pathname])

  // Tells anything pinned to the bottom of the viewport that there is a tab
  // bar in the way. Set on <html> rather than passed down, because the install
  // banner is rendered by PwaProvider and is a sibling of this tree, not a
  // descendant — a CSS variable on an ancestor would never reach it.
  useEffect(() => {
    document.documentElement.classList.add('has-bottom-nav')
    return () => document.documentElement.classList.remove('has-bottom-nav')
  }, [])

  return (
    <div className="min-h-dvh pb-[calc(var(--bottom-nav-height)+env(safe-area-inset-bottom))]">
      {/* The first focusable thing on every page. Without it a keyboard user
          tabs through eleven navigation items before reaching the content, on
          every single page — which is the kind of tax that makes an app
          unusable rather than merely awkward.

          Visible only while focused: `sr-only` until `focus:not-sr-only` puts
          it back, which is the one place that pattern is correct. */}
      <a
        href={`#${MAIN_CONTENT_ID}`}
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring"
      >
        Skip to content
      </a>

      <RouteAnnouncer />

      <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
        <div className="container flex h-16 items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <span className="text-lg font-semibold tracking-tight">{APP_NAME}</span>
            <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
              {nav.map(({ href, label, exact }) => (
                <Link
                  key={href}
                  href={href}
                  aria-current={isActive(href, exact) ? 'page' : undefined}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                    isActive(href, exact)
                      ? 'bg-secondary text-secondary-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-4">
            <DualTime
              tzSelf={tzSelf}
              tzPartner={tzPartner}
              labelPartner={partnerRef?.displayName ?? 'Them'}
              className="hidden scale-90 sm:flex"
            />
            <div className="flex -space-x-1.5">
              <PersonBadge person={selfRef} />
              <PersonBadge person={partnerRef} />
            </div>
          </div>
        </div>
      </header>

      {/* `tabIndex={-1}` keeps <main> out of everybody's tab order while still
          letting the skip link and the route announcer move focus here. */}
      <main id={MAIN_CONTENT_ID} tabIndex={-1} className="container py-6 focus:outline-none">
        {children}
      </main>

      {/* `env(safe-area-inset-bottom)` is not decoration: with viewport-fit set
          to cover, the bar's last row otherwise sits underneath the home
          indicator on any iPhone without a physical button. Invisible in a
          browser tab, where the toolbar absorbs it, and obvious the moment the
          app is installed and that toolbar is gone. */}
      <nav
        className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
        // Distinct from the header's landmark. Two navigations both announced
        // as "Main" are two things a screen-reader user cannot tell apart in a
        // landmark list, even though only one is visible at a time.
        aria-label="Sections"
      >
        <div className="flex snap-x overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {nav.map(({ href, label, short, icon: Icon, exact }) => (
            <Link
              key={href}
              href={href}
              ref={isActive(href, exact) ? activeRef : undefined}
              aria-current={isActive(href, exact) ? 'page' : undefined}
              className={cn(
                'flex w-16 shrink-0 snap-center flex-col items-center gap-1 py-2.5 text-[10px] font-medium',
                isActive(href, exact) ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              <Icon className="size-5" aria-hidden="true" />
              <span aria-hidden="true">{short}</span>
              <span className="sr-only">{label}</span>
            </Link>
          ))}
        </div>
      </nav>
    </div>
  )
}
