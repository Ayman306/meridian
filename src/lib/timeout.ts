/**
 * Bound a promise that talks to somebody else's server.
 *
 * Exists because of a real outage: `proxy.ts` awaited a Supabase auth refresh
 * with no timeout, on every request. When that call stalled, every route in
 * the app stalled with it — including the sign-in page, which needs no session
 * at all — until Vercel killed the function at 300 seconds. A slow dependency
 * became a total outage, and a blank tab for five minutes.
 *
 * The rule this encodes: **a call to another service on the critical path of
 * every request must have a deadline.** What happens after the deadline is the
 * caller's decision, and is usually "carry on with less".
 */

/**
 * Resolve with the promise's value, or with `fallback` if it takes too long or
 * rejects.
 *
 * Rejection and timeout collapse into the same answer on purpose. From the
 * caller's side "the refresh did not happen" is one outcome with one sensible
 * response, and distinguishing them would mean two error paths that do the
 * same thing.
 *
 * The underlying promise is **not** cancelled — it cannot be, and a rejection
 * arriving after the deadline would otherwise be unhandled and crash the
 * process. It is left attached to a no-op handler and allowed to finish into
 * nothing.
 */
export async function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  fallback: T,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined

  // Swallow a late rejection. Without this, a promise that rejects after the
  // race has been settled is an unhandled rejection — which in a serverless
  // runtime can take down the invocation the timeout was meant to protect.
  const guarded = work.catch(() => fallback)

  try {
    return await Promise.race([
      guarded,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
