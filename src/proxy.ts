/**
 * Refreshes the Supabase session on every request and writes the rotated
 * cookies back onto the response.
 *
 * This is Next 16's `proxy`, the renamed middleware.
 *
 * Server Components cannot set cookies, so without this a session would expire
 * mid-visit and the server and browser would disagree about who is signed in.
 *
 * ## The refresh has a deadline, and that is the important part
 *
 * This ran for months as a bare `await supabase.auth.getUser()`. That call
 * crosses the network to Supabase Auth, it sits on the critical path of *every*
 * request, and it had no timeout and no error handling. The consequences,
 * observed in production rather than imagined:
 *
 *   - When it stalled, every route stalled — including `/login`, which needs
 *     no session at all — until Vercel killed the invocation at 300 seconds.
 *   - Only signed-in people were affected, which is the cruel part. With no
 *     session cookie the call short-circuits locally and returns at once, so
 *     the cron routes kept returning 200 and the app looked healthy to every
 *     check that was not carrying a real session. The people who could not use
 *     it were exactly the two people it is for.
 *
 * So the refresh is now bounded. If it does not finish in time the request
 * continues **without** a rotated cookie: the session is a little staler, the
 * browser client refreshes on its own soon after, and the page renders. That
 * is a real cost and it is the right one — a stale session is an inconvenience,
 * a hung app is an outage.
 */
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { withTimeout } from '@/lib/timeout'

/**
 * Long enough for a healthy round trip to Supabase Auth — which is tens of
 * milliseconds warm, and can be a second or so on a cold connection from a
 * region away from the project. Short enough that a person never notices it
 * being spent, let alone waits behind it.
 */
const REFRESH_TIMEOUT_MS = 2_500

export default async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) return response

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value } of toSet) request.cookies.set(name, value)
        response = NextResponse.next({ request })
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options)
      },
    },
  })

  // Touching getUser() is what triggers the refresh. Do not remove it, and do
  // not put anything between creating the client and calling it.
  //
  // Bounded, and never allowed to throw: this runs before every page, so an
  // error here is an error on every page. `withTimeout` collapses a stall and
  // a failure into the same outcome — no refresh this time — because there is
  // only one sensible response to either.
  await withTimeout(supabase.auth.getUser(), REFRESH_TIMEOUT_MS, null)

  return response
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image files — those never carry a
     * session and refreshing on each one would be pure overhead.
     *
     * The PWA's own files are excluded for a sharper reason than overhead: the
     * service worker, the manifest and the icons are what let an installed app
     * start at all. Putting an auth round trip in front of them means a bad day
     * at Supabase stops the app booting, rather than merely stopping it
     * signing anybody in.
     */
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
