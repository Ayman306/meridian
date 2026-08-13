/**
 * OAuth redirect target. Google sends the user back here with a code; we swap
 * it for a session, which `createServerSupabase` writes into cookies.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/'

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`)
  }

  const supabase = await createServerSupabase()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`)
  }

  // Only ever redirect to a path on this origin — an open redirect here would
  // hand someone's freshly minted session to another site.
  const target = next.startsWith('/') ? next : '/'
  return NextResponse.redirect(`${origin}${target}`)
}
