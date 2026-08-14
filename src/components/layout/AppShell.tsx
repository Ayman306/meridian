'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CalendarRange, FileText, Heart, Home, Map as MapIcon, Settings as SettingsIcon } from 'lucide-react'
import { useCouple } from '@/providers/CoupleProvider'
import { DualTime } from '@/components/DualTime'
import { PersonBadge } from '@/components/PersonBadge'
import { APP_NAME } from '@/lib/constants'
import { cn } from '@/lib/utils'

/**
 * `short` is what the bottom bar uses: six columns on a 360px screen leaves
 * about nine characters before the label wraps.
 */
const NAV = [
  { href: '/', label: 'Home', short: 'Home', icon: Home, exact: true },
  { href: '/trips', label: 'Trips', short: 'Trips', icon: CalendarRange, exact: false },
  { href: '/wishlist', label: 'Wishlist', short: 'Saves', icon: Heart, exact: false },
  { href: '/map', label: 'Map', short: 'Map', icon: MapIcon, exact: false },
  { href: '/documents', label: 'Docs', short: 'Docs', icon: FileText, exact: false },
  { href: '/settings', label: 'Settings', short: 'You', icon: SettingsIcon, exact: false },
] as const

export function AppShell({ children }: { children: React.ReactNode }) {
  const { selfRef, partnerRef, tzSelf, tzPartner } = useCouple()
  const pathname = usePathname()

  const isActive = (href: string, exact: boolean) =>
    exact ? pathname === href : pathname.startsWith(href)

  return (
    <div className="min-h-dvh pb-16 md:pb-0">
      <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
        <div className="container flex h-16 items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <span className="text-lg font-semibold tracking-tight">{APP_NAME}</span>
            <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
              {NAV.map(({ href, label, exact }) => (
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

      <main className="container py-6">{children}</main>

      <nav
        className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 backdrop-blur md:hidden"
        aria-label="Main"
      >
        <div className="grid grid-cols-6">
          {NAV.map(({ href, label, short, icon: Icon, exact }) => (
            <Link
              key={href}
              href={href}
              aria-current={isActive(href, exact) ? 'page' : undefined}
              className={cn(
                'flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium',
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
