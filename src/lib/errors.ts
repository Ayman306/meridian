/**
 * Normalised error shapes (spec 0.7). Every data view must be able to render
 * "what failed" and offer a retry, so every failure funnels through AppError.
 */
import type { PostgrestError } from '@supabase/supabase-js'

export type ErrorKind =
  | 'auth' // not signed in / session expired
  | 'permission' // RLS said no
  | 'not_found'
  | 'conflict' // unique violation, couple already full
  | 'validation'
  | 'network'
  | 'rate_limit'
  | 'upstream' // a third-party API failed
  | 'unknown'

export class AppError extends Error {
  readonly kind: ErrorKind
  /** Stable machine code, e.g. INVALID_CODE, COUPLE_FULL. */
  readonly code: string | undefined
  /** Whether offering a retry button makes sense. */
  readonly retryable: boolean
  readonly cause: unknown

  constructor(
    message: string,
    opts: { kind?: ErrorKind; code?: string; retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message)
    this.name = 'AppError'
    this.kind = opts.kind ?? 'unknown'
    this.code = opts.code
    this.retryable = opts.retryable ?? (this.kind === 'network' || this.kind === 'upstream')
    this.cause = opts.cause
  }
}

/** Domain errors raised by our RPCs, mapped to copy the user can act on. */
const RPC_MESSAGES: Record<string, { kind: ErrorKind; message: string }> = {
  INVALID_CODE: {
    kind: 'not_found',
    message: "That code doesn't match an active invite. Check it, or ask for a new one.",
  },
  EXPIRED_CODE: {
    kind: 'validation',
    message: 'That invite code has expired. Ask your partner to generate a new one.',
  },
  COUPLE_FULL: {
    kind: 'conflict',
    message: 'That couple already has two members.',
  },
  ALREADY_PAIRED: {
    kind: 'conflict',
    message: "You're already paired. Leave your current couple first, in Settings.",
  },
  NOT_A_MEMBER: {
    kind: 'permission',
    message: "You're not a member of that couple.",
  },
}

const PG_CODES: Record<string, { kind: ErrorKind; message: string }> = {
  '23505': { kind: 'conflict', message: 'That already exists.' },
  '23503': { kind: 'validation', message: 'That refers to something that no longer exists.' },
  '23514': { kind: 'validation', message: "That doesn't pass a validation rule." },
  '42501': { kind: 'permission', message: "You don't have access to that." },
  PGRST301: { kind: 'auth', message: 'Your session expired. Sign in again.' },
  PGRST116: { kind: 'not_found', message: 'Not found.' },
}

function isPostgrestError(e: unknown): e is PostgrestError {
  return typeof e === 'object' && e !== null && 'message' in e && 'code' in e
}

/** Turn anything thrown by Supabase, fetch, or our own code into an AppError. */
export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e

  if (isPostgrestError(e)) {
    // Our RPCs raise `RAISE EXCEPTION 'CODE'`; Postgres surfaces the bare code.
    const domain = RPC_MESSAGES[e.message?.trim()]
    if (domain) {
      return new AppError(domain.message, {
        kind: domain.kind,
        code: e.message.trim(),
        retryable: false,
        cause: e,
      })
    }
    const mapped = e.code ? PG_CODES[e.code] : undefined
    if (mapped) {
      return new AppError(mapped.message, { kind: mapped.kind, code: e.code, cause: e })
    }
    return new AppError(e.message || 'Something went wrong.', { code: e.code, cause: e })
  }

  if (e instanceof TypeError && /fetch|network/i.test(e.message)) {
    return new AppError("Couldn't reach the server. Check your connection.", {
      kind: 'network',
      retryable: true,
      cause: e,
    })
  }

  if (e instanceof Error) {
    const domain = RPC_MESSAGES[e.message.trim()]
    if (domain) {
      return new AppError(domain.message, {
        kind: domain.kind,
        code: e.message.trim(),
        retryable: false,
        cause: e,
      })
    }
    return new AppError(e.message, { cause: e })
  }

  return new AppError('Something went wrong.', { cause: e })
}

/**
 * A Supabase response is a union: `{ data: T, error: null } | { data: null,
 * error: PostgrestError }`. Inferring a bare `<T>` against that union picks up
 * `null` from the failure branch and collapses the row type to nothing, so we
 * infer the envelope and dig the payload out with a distributive conditional.
 */
type Envelope = { data: unknown; error: unknown }
type Payload<R extends Envelope> = R extends { data: infer D } ? Exclude<D, null> : never

/** A list result. Errors throw; an empty list is a legitimate answer. */
export function unwrapList<R extends Envelope>(res: R): Payload<R> {
  if (res.error) throw toAppError(res.error)
  return (res.data ?? []) as Payload<R>
}

/** Unwrap a Supabase `{ data, error }` envelope or throw a normalised error. */
export function unwrap<R extends Envelope>(res: R): Payload<R> {
  if (res.error) throw toAppError(res.error)
  if (res.data === null || res.data === undefined) {
    throw new AppError('Not found.', { kind: 'not_found', retryable: false })
  }
  return res.data as Payload<R>
}

/** Same as `unwrap`, but a null result is legitimate (e.g. "no couple yet"). */
export function unwrapMaybe<R extends Envelope>(res: R): Payload<R> | null {
  if (res.error) throw toAppError(res.error)
  return (res.data ?? null) as Payload<R> | null
}

/** Message safe to render to a user. Never leaks stack traces or SQL. */
export function userMessage(e: unknown): string {
  return toAppError(e).message
}
