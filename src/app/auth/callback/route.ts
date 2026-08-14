/**
 * OAuth redirect target. Google sends the user back here with a code; we swap
 * it for a session, which `createServerSupabase` writes into cookies.
 *
 * This must be the `redirectTo` given to `signInWithOAuth` and must appear in
 * Supabase's redirect allowlist. Sending the user to a page instead means the
 * code is never exchanged and the app's auth gate bounces them to `/login`.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { safeRedirectPath } from '@/modules/auth/logic'

/**
 * Behind a proxy (Vercel, any reverse proxy) `request.url` carries the internal
 * host, so a redirect built from it would send the browser somewhere it cannot
 * reach. The forwarded host is only ever used to rebuild *our own* origin — the
 * path is always one we choose — so a spoofed header cannot redirect off-site.
 */
function originOf(request: NextRequest, fallback: string): string {
  const host = request.headers.get('x-forwarded-host')
  if (!host) return fallback
  const proto = request.headers.get('x-forwarded-proto') ?? 'https'
  return `${proto}://${host}`
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const origin = originOf(request, url.origin)
  const next = safeRedirectPath(url.searchParams.get('next'))

  const fail = (reason: string) =>
    NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(reason)}`)

  // Google or Supabase refused before we ever got a code — consent declined,
  // an origin that is not on the allowlist, a misconfigured client.
  const providerError = url.searchParams.get('error_description') ?? url.searchParams.get('error')
  if (providerError) return fail(providerError)

  const code = url.searchParams.get('code')
  if (!code) return fail('No sign-in code came back from Google.')

  const supabase = await createServerSupabase()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) return fail(error.message)

  return NextResponse.redirect(`${origin}${next}`)
}
