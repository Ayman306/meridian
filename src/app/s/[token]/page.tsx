import { SharePage } from '@/modules/gallery'

/**
 * Outside the app shell and outside the auth gate: whoever opens this has a
 * link and nothing else. `src/app/(app)/layout.tsx` is what redirects
 * unauthenticated requests, and this route deliberately sits beside it rather
 * than inside it.
 */
export default async function Share({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <SharePage token={token} />
}
