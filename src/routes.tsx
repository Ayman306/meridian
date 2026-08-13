/**
 * Routing skeleton. Guards are layered deliberately:
 *
 *   RequireAuth   → signed in at all
 *   RequireCouple → paired; solo users are sent to /pair, which is a real state
 *   RequireSetup  → knows where they are, so clocks and distances work
 *
 * Screens for modules not yet built render a Placeholder rather than 404, so
 * the shell is navigable from the first commit.
 */
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState, PageLoading } from '@/components/common/states'
import { useAuth } from '@/providers/AuthProvider'
import { useCouple } from '@/providers/CoupleProvider'
import { LoginPage, PairPage, SetupPage } from '@/modules/auth'
import { needsProfileSetup } from '@/modules/auth/logic'

function RequireAuth() {
  const { session, isLoading } = useAuth()
  const location = useLocation()
  if (isLoading) return <FullPageLoading />
  if (!session) return <Navigate to="/login" replace state={{ from: location }} />
  return <Outlet />
}

function RequireCouple() {
  const { isLoading, isSolo } = useCouple()
  if (isLoading) return <FullPageLoading />
  if (isSolo) return <Navigate to="/pair" replace />
  return <Outlet />
}

function RequireSetup() {
  const { self, isLoading } = useCouple()
  if (isLoading) return <FullPageLoading />
  if (needsProfileSetup(self)) return <Navigate to="/setup" replace />
  return <Outlet />
}

function FullPageLoading() {
  return (
    <div className="container py-16">
      <PageLoading />
    </div>
  )
}

/** A screen whose module is scheduled but not yet built. */
function Placeholder({ title, phase }: { title: string; phase: string }) {
  return (
    <>
      <PageHeader title={title} />
      <EmptyState
        title="Not built yet"
        description={`${title} arrives in ${phase}. The route, shell and guards are already in place.`}
      />
    </>
  )
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<RequireAuth />}>
        <Route path="/pair" element={<PairPage />} />
        <Route path="/setup" element={<SetupPage />} />

        <Route element={<RequireCouple />}>
          <Route element={<RequireSetup />}>
            <Route element={<AppShell />}>
              <Route index element={<Placeholder title="Home" phase="Phase 5 (Dashboard)" />} />
              <Route path="trips" element={<Placeholder title="Trips" phase="Phase 2" />} />
              <Route path="trips/:id/*" element={<Placeholder title="Trip" phase="Phase 2" />} />
              <Route
                path="documents"
                element={<Placeholder title="Documents" phase="Phase 4" />}
              />
              <Route path="settings" element={<Placeholder title="Settings" phase="Phase 13" />} />
            </Route>
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
