/**
 * Guard for cron-triggered Route Handlers.
 *
 * These run with no user, so RLS has nothing to key off and they use the
 * service-role client. That makes the secret check the only thing standing
 * between a public URL and every couple's data — check it first, before
 * touching anything else.
 */
import { AppError } from '@/lib/errors'

export function assertCronRequest(request: Request): void {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    throw new AppError('CRON_SECRET is not configured.', { kind: 'permission', retryable: false })
  }

  const provided = request.headers.get('x-cron-secret')
  if (!provided || !timingSafeEqual(provided, expected)) {
    throw new AppError('Not authorised.', { kind: 'permission', retryable: false })
  }
}

/** Constant-time compare, so the secret can't be guessed a byte at a time. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
