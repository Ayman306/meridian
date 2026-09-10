/**
 * /oauth/consent — where Supabase sends somebody to approve an assistant.
 *
 * Supabase Auth runs the OAuth flow: it validated the client, it validated the
 * redirect URI, it will issue and refresh the tokens. It hands over exactly one
 * decision, with an `authorization_id`, and this is where that decision is made.
 *
 * The URL is configured in the Supabase dashboard under Authentication → OAuth
 * Server → Authorization Path, combined with the project's Site URL. If those
 * two do not add up to this page, the flow dead-ends here.
 *
 * Sign-in is required first, and `next` carries the whole query string, so
 * somebody signed out lands back on this exact request rather than on the
 * dashboard with the connection silently abandoned.
 */
import { redirect } from 'next/navigation'
import { requireUser } from '@/lib/supabase/server'
import { ConsentScreen } from '@/modules/settings'

export const dynamic = 'force-dynamic'

export default async function Consent({
  searchParams,
}: {
  searchParams: Promise<{ authorization_id?: string }>
}) {
  const { authorization_id: authorizationId } = await searchParams

  if (!authorizationId) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm space-y-3 text-center">
          <h1 className="text-xl font-semibold">Nothing to approve</h1>
          <p className="text-sm text-muted-foreground">
            This page is where an assistant sends you to ask for access. Opening it directly has
            nothing to act on.
          </p>
          <a className="text-sm underline underline-offset-4" href="/">
            Back to Meridian
          </a>
        </div>
      </main>
    )
  }

  const user = await requireUser()
  if (!user) {
    const back = `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`
    redirect(`/login?next=${encodeURIComponent(back)}`)
  }

  return <ConsentScreen authorizationId={authorizationId} />
}
