import { NavLink, Outlet } from 'react-router-dom'
import { CalendarRange, FileText, Home, Settings as SettingsIcon } from 'lucide-react'
import { useCouple } from '@/providers/CoupleProvider'
import { DualTime } from '@/components/DualTime'
import { PersonBadge } from '@/components/PersonBadge'
import { APP_NAME } from '@/lib/constants'
import { cn } from '@/lib/utils'

const NAV = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/trips', label: 'Trips', icon: CalendarRange, end: false },
  { to: '/documents', label: 'Docs', icon: FileText, end: false },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, end: false },
]

export function AppShell() {
  const { selfRef, partnerRef, tzSelf, tzPartner } = useCouple()

  return (
    <div className="min-h-dvh pb-16 md:pb-0">
      <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
        <div className="container flex h-16 items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <span className="text-lg font-semibold tracking-tight">{APP_NAME}</span>
            <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
              {NAV.map(({ to, label, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    cn(
                      'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-secondary text-secondary-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                    )
                  }
                >
                  {label}
                </NavLink>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-4">
            <DualTime
              tzSelf={tzSelf}
              tzPartner={tzPartner}
              labelSelf={selfRef?.isSelf ? 'You' : 'You'}
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

      <main className="container py-6">
        <Outlet />
      </main>

      <nav
        className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 backdrop-blur md:hidden"
        aria-label="Main"
      >
        <div className="grid grid-cols-4">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium',
                  isActive ? 'text-foreground' : 'text-muted-foreground',
                )
              }
            >
              <Icon className="size-5" aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
